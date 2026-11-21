import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
// Import setup to initialize MongoDB
import '../setup.js';
import app from '../../src/app.js';
import Bookmark from '../../src/models/Bookmark.js';
import Thread from '../../src/models/Thread.js';
import Subreddit from '../../src/models/Subreddit.js';
import dotenv from 'dotenv';
dotenv.config();

let alice;
let bob;

async function createUserAndLogin(name) {
  const email = `${name.toLowerCase()}+${Date.now()}@example.com`;
  const password = 'password123';

  const userRes = await request(app).post('/api/auth/register').send({ name, email, password });
  const loginRes = await request(app).post('/api/auth/login').send({ email, password });

  return { user: userRes.body.data, token: loginRes.body.data.token };
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

// Every key name at any depth of a JSON value.
const allKeys = (value) => {
  if (Array.isArray(value)) return value.flatMap(allKeys);
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => [key, ...allKeys(child)]);
  }
  return [];
};

beforeAll(async () => {
  alice = await createUserAndLogin('Alice');
  bob = await createUserAndLogin('Bob');
  // The unique { user, thread } index builds asynchronously; wait for it so
  // the duplicate-save tests exercise the real constraint.
  await Bookmark.init();
});

describe('Bookmarks API', () => {
  let subreddit;
  let threads;

  beforeEach(async () => {
    // tests/setup.js only clears Thread and Subreddit, so clean our own collection.
    await Promise.all([Bookmark.deleteMany({}), Thread.deleteMany({}), Subreddit.deleteMany({})]);

    subreddit = await Subreddit.create({
      name: 'test-subreddit-bookmarks',
      description: 'Subreddit for bookmark tests',
      author: alice.user._id,
    });

    threads = await Thread.create(
      ['First thread', 'Second thread', 'Third thread'].map((title) => ({
        title,
        content: `${title} content`,
        author: alice.user._id,
        subreddit: subreddit._id,
      })),
    );
  });

  const id = (index) => threads[index]._id.toString();
  const save = (token, threadId) =>
    request(app).put(`/api/bookmarks/${threadId}`).set(auth(token));

  describe('authentication', () => {
    it('returns 401 on every endpoint without a token', async () => {
      const threadId = id(0);
      const responses = await Promise.all([
        request(app).get('/api/bookmarks'),
        request(app).get('/api/bookmarks/ids'),
        request(app).put(`/api/bookmarks/${threadId}`),
        request(app).delete(`/api/bookmarks/${threadId}`),
      ]);

      responses.forEach((res) => {
        expect(res.status).toBe(401);
        expect(res.body).toEqual({
          success: false,
          message: 'No token provided, authorization denied.',
        });
      });
    });

    it('returns 401 with an invalid token', async () => {
      const res = await request(app).get('/api/bookmarks').set(auth('not-a-real-token'));

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Token is not valid.');
    });
  });

  describe('saving', () => {
    it('saves a thread and lists it with savedAt and limited author/subreddit fields', async () => {
      const putRes = await save(alice.token, id(0));

      expect(putRes.status).toBe(200);
      expect(putRes.body.message).toBe('Thread saved');
      expect(putRes.body.data).toMatchObject({ threadId: id(0), saved: true });
      expect(typeof putRes.body.data.savedAt).toBe('string');

      const listRes = await request(app).get('/api/bookmarks').set(auth(alice.token));

      expect(listRes.status).toBe(200);
      expect(listRes.body.message).toBe('Bookmarks fetched successfully');
      expect(listRes.body.data).toHaveLength(1);
      const [saved] = listRes.body.data;
      expect(saved).toMatchObject({
        _id: id(0),
        title: 'First thread',
        content: 'First thread content',
        voteCount: 0,
        savedAt: putRes.body.data.savedAt,
      });
      expect(Object.keys(saved.author).sort()).toEqual(['_id', 'name']);
      expect(saved.author.name).toBe('Alice');
      expect(Object.keys(saved.subreddit).sort()).toEqual(['_id', 'name']);
      expect(saved).not.toHaveProperty('upvotedBy');
      expect(saved).not.toHaveProperty('downvotedBy');
    });

    it('includes a saved thread in the ids list', async () => {
      await save(alice.token, id(1));

      const res = await request(app).get('/api/bookmarks/ids').set(auth(alice.token));

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Bookmark ids fetched successfully');
      expect(res.body.data).toEqual([id(1)]);
    });

    it('keeps one bookmark and the original savedAt when saved twice in a row', async () => {
      const first = await save(alice.token, id(0));
      const second = await save(alice.token, id(0));

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body.data.savedAt).toBe(first.body.data.savedAt);
      expect(await Bookmark.countDocuments({ user: alice.user._id })).toBe(1);
    });

    it('keeps one bookmark when saved twice concurrently', async () => {
      const [first, second] = await Promise.all([save(alice.token, id(0)), save(alice.token, id(0))]);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body.data.savedAt).toBe(first.body.data.savedAt);
      expect(await Bookmark.countDocuments({ user: alice.user._id })).toBe(1);
    });

    it('returns 404 for a thread that does not exist', async () => {
      const res = await save(alice.token, new mongoose.Types.ObjectId().toString());

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ success: false, message: 'Thread not found' });
    });

    it('returns 400 for an invalid thread id', async () => {
      const res = await save(alice.token, 'abc');

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, message: 'Invalid thread id' });
    });
  });

  describe('unsaving', () => {
    it('removes a saved thread', async () => {
      await save(alice.token, id(0));

      const delRes = await request(app).delete(`/api/bookmarks/${id(0)}`).set(auth(alice.token));
      const listRes = await request(app).get('/api/bookmarks').set(auth(alice.token));

      expect(delRes.status).toBe(200);
      expect(delRes.body).toEqual({
        success: true,
        message: 'Thread unsaved',
        data: { threadId: id(0), saved: false },
      });
      expect(listRes.body.data).toEqual([]);
    });

    it('returns 200 when the thread was never saved', async () => {
      const res = await request(app).delete(`/api/bookmarks/${id(2)}`).set(auth(alice.token));

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ threadId: id(2), saved: false });
    });

    it('returns 400 for an invalid thread id', async () => {
      const res = await request(app).delete('/api/bookmarks/abc').set(auth(alice.token));

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid thread id');
    });
  });

  describe('listing', () => {
    it('hides and cleans up bookmarks of deleted threads', async () => {
      await save(alice.token, id(0));
      await save(alice.token, id(1));
      await Thread.deleteOne({ _id: threads[0]._id });

      const idsRes = await request(app).get('/api/bookmarks/ids').set(auth(alice.token));
      expect(idsRes.body.data).toEqual([id(1)]);

      const listRes = await request(app).get('/api/bookmarks').set(auth(alice.token));
      expect(listRes.body.data.map((t) => t._id)).toEqual([id(1)]);

      // The orphaned bookmark document is gone after the list request.
      expect(await Bookmark.countDocuments({ user: alice.user._id })).toBe(1);
      expect(await Bookmark.exists({ thread: threads[0]._id })).toBeNull();
    });

    it("never shows one user's bookmarks to another", async () => {
      await save(alice.token, id(0));

      const listRes = await request(app).get('/api/bookmarks').set(auth(bob.token));
      const idsRes = await request(app).get('/api/bookmarks/ids').set(auth(bob.token));
      const delRes = await request(app).delete(`/api/bookmarks/${id(0)}`).set(auth(bob.token));

      expect(listRes.body.data).toEqual([]);
      expect(idsRes.body.data).toEqual([]);
      expect(delRes.status).toBe(200);
      // Bob's unsave did not touch Alice's bookmark.
      expect(await Bookmark.countDocuments({ user: alice.user._id })).toBe(1);
    });

    it('lists bookmarks newest-saved first', async () => {
      for (const index of [0, 1, 2]) {
        await save(alice.token, id(index));
      }
      // Pin distinct save times so the order doesn't depend on clock resolution.
      // createdAt is immutable through Mongoose, so go through the driver.
      const days = { 0: '2026-01-01', 1: '2026-01-03', 2: '2026-01-02' };
      for (const [index, day] of Object.entries(days)) {
        await Bookmark.collection.updateOne(
          { user: new mongoose.Types.ObjectId(alice.user._id), thread: threads[index]._id },
          { $set: { createdAt: new Date(`${day}T00:00:00Z`) } },
        );
      }

      const res = await request(app).get('/api/bookmarks').set(auth(alice.token));

      expect(res.body.data.map((t) => t.title)).toEqual(['Second thread', 'Third thread', 'First thread']);
    });

    it('never returns a password or email anywhere in a response', async () => {
      const putRes = await save(alice.token, id(0));
      const listRes = await request(app).get('/api/bookmarks').set(auth(alice.token));
      const idsRes = await request(app).get('/api/bookmarks/ids').set(auth(alice.token));

      for (const res of [putRes, listRes, idsRes]) {
        const keys = allKeys(res.body);
        expect(keys).not.toContain('password');
        expect(keys).not.toContain('email');
      }
    });
  });
});
