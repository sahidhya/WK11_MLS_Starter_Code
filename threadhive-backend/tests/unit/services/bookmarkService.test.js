import { describe, it, expect, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';

vi.mock('../../../src/models/Bookmark.js', () => ({
  default: {
    find: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    deleteMany: vi.fn(),
    deleteOne: vi.fn(),
  },
}));
vi.mock('../../../src/models/Thread.js', () => ({
  default: {
    find: vi.fn(),
    exists: vi.fn(),
  },
}));

import Bookmark from '../../../src/models/Bookmark.js';
import Thread from '../../../src/models/Thread.js';
import {
  listBookmarks,
  listBookmarkedThreadIds,
  saveBookmark,
  removeBookmark,
} from '../../../src/services/bookmarkService.js';

// Chainable stand-in for a Mongoose query: every method returns the query
// itself, except `terminal`, which resolves with `result`.
const mockQuery = (result, terminal = 'lean') => {
  const query = {};
  ['sort', 'populate', 'select', 'lean', 'distinct'].forEach((method) => {
    query[method] = vi.fn(() => (method === terminal ? Promise.resolve(result) : query));
  });
  return query;
};

const newId = () => new mongoose.Types.ObjectId().toString();

describe('bookmarkService', () => {
  let userId;
  let threadId;

  beforeEach(() => {
    vi.clearAllMocks();
    userId = newId();
    threadId = newId();
  });

  describe('saveBookmark', () => {
    it('creates a bookmark when the thread exists', async () => {
      const savedAt = new Date('2026-11-21T10:00:00Z');
      Thread.exists.mockResolvedValue({ _id: threadId });
      Bookmark.findOneAndUpdate.mockResolvedValue({ createdAt: savedAt });

      const result = await saveBookmark(userId, threadId);

      expect(Thread.exists).toHaveBeenCalledWith({ _id: threadId });
      expect(Bookmark.findOneAndUpdate).toHaveBeenCalledWith(
        { user: userId, thread: threadId },
        { $setOnInsert: { user: userId, thread: threadId } },
        { upsert: true, new: true },
      );
      expect(result).toEqual({ threadId, saved: true, savedAt });
    });

    it('returns the original savedAt when the thread is already saved', async () => {
      const originalSavedAt = new Date('2026-01-01T00:00:00Z');
      Thread.exists.mockResolvedValue({ _id: threadId });
      Bookmark.findOneAndUpdate.mockResolvedValue({ createdAt: originalSavedAt });

      const result = await saveBookmark(userId, threadId);

      expect(result.savedAt).toBe(originalSavedAt);
    });

    it('treats a duplicate-key error from a concurrent save as success', async () => {
      const savedAt = new Date('2026-11-21T10:00:00Z');
      Thread.exists.mockResolvedValue({ _id: threadId });
      Bookmark.findOneAndUpdate.mockRejectedValue(Object.assign(new Error('E11000'), { code: 11000 }));
      Bookmark.findOne.mockResolvedValue({ createdAt: savedAt });

      const result = await saveBookmark(userId, threadId);

      expect(Bookmark.findOne).toHaveBeenCalledWith({ user: userId, thread: threadId });
      expect(result).toEqual({ threadId, saved: true, savedAt });
    });

    it('rethrows errors other than duplicate key', async () => {
      Thread.exists.mockResolvedValue({ _id: threadId });
      Bookmark.findOneAndUpdate.mockRejectedValue(new Error('Database down'));

      await expect(saveBookmark(userId, threadId)).rejects.toThrow('Database down');
      expect(Bookmark.findOne).not.toHaveBeenCalled();
    });

    it('throws 400 for an invalid id without querying', async () => {
      await expect(saveBookmark(userId, 'abc')).rejects.toMatchObject({
        message: 'Invalid thread id',
        statusCode: 400,
      });
      expect(Thread.exists).not.toHaveBeenCalled();
      expect(Bookmark.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('rejects 12-character strings that isValidObjectId would accept', async () => {
      await expect(saveBookmark(userId, 'abcdefghijkl')).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 404 when the thread does not exist', async () => {
      Thread.exists.mockResolvedValue(null);

      await expect(saveBookmark(userId, threadId)).rejects.toMatchObject({
        message: 'Thread not found',
        statusCode: 404,
      });
      expect(Bookmark.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe('removeBookmark', () => {
    it("deletes the user's bookmark", async () => {
      Bookmark.deleteOne.mockResolvedValue({ deletedCount: 1 });

      const result = await removeBookmark(userId, threadId);

      expect(Bookmark.deleteOne).toHaveBeenCalledWith({ user: userId, thread: threadId });
      expect(result).toEqual({ threadId, saved: false });
    });

    it('succeeds when nothing was saved', async () => {
      Bookmark.deleteOne.mockResolvedValue({ deletedCount: 0 });

      await expect(removeBookmark(userId, threadId)).resolves.toEqual({ threadId, saved: false });
    });

    it('does not check that the thread exists', async () => {
      Bookmark.deleteOne.mockResolvedValue({ deletedCount: 1 });

      await removeBookmark(userId, threadId);

      expect(Thread.exists).not.toHaveBeenCalled();
    });

    it('throws 400 for an invalid id without querying', async () => {
      await expect(removeBookmark(userId, 'abc')).rejects.toMatchObject({ statusCode: 400 });
      expect(Bookmark.deleteOne).not.toHaveBeenCalled();
    });
  });

  describe('listBookmarks', () => {
    it('queries by user, newest first, with author and subreddit limited to name', async () => {
      const query = mockQuery([]);
      Bookmark.find.mockReturnValue(query);

      await listBookmarks(userId);

      expect(Bookmark.find).toHaveBeenCalledWith({ user: userId });
      expect(query.sort).toHaveBeenCalledWith({ createdAt: -1 });
      const populateArg = query.populate.mock.calls[0][0];
      expect(populateArg.path).toBe('thread');
      expect(populateArg.select).not.toMatch(/upvotedBy|downvotedBy/);
      expect(populateArg.populate).toEqual([
        { path: 'author', select: 'name' },
        { path: 'subreddit', select: 'name' },
      ]);
    });

    it('maps each bookmark to its thread with savedAt', async () => {
      const savedAt = new Date('2026-11-21T10:00:00Z');
      const createdAt = new Date('2026-11-01T08:00:00Z');
      const thread = {
        _id: threadId,
        title: 'How do I learn Rust?',
        content: 'Coming from JavaScript',
        voteCount: 4,
        upvotes: 5,
        downvotes: 1,
        createdAt,
        author: { _id: 'u1', name: 'Alice' },
        subreddit: { _id: 's1', name: 'programming' },
      };
      Bookmark.find.mockReturnValue(mockQuery([{ _id: 'b1', createdAt: savedAt, thread }]));

      const result = await listBookmarks(userId);

      expect(result).toEqual([{ ...thread, savedAt }]);
    });

    it('keeps a thread whose author or subreddit populated to null, with those fields null', async () => {
      const thread = { _id: threadId, title: 'Orphaned author', author: null, subreddit: null };
      Bookmark.find.mockReturnValue(mockQuery([{ _id: 'b1', createdAt: new Date(), thread }]));

      const result = await listBookmarks(userId);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ _id: threadId, author: null, subreddit: null });
      expect(Bookmark.deleteMany).not.toHaveBeenCalled();
    });

    it('filters out and deletes bookmarks whose thread was deleted', async () => {
      const orphanId = newId();
      Bookmark.find.mockReturnValue(
        mockQuery([
          { _id: 'b1', createdAt: new Date(), thread: { _id: threadId, title: 'Kept' } },
          { _id: orphanId, createdAt: new Date(), thread: null },
        ]),
      );
      Bookmark.deleteMany.mockResolvedValue({ deletedCount: 1 });

      const result = await listBookmarks(userId);

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Kept');
      expect(Bookmark.deleteMany).toHaveBeenCalledWith({ _id: { $in: [orphanId] } });
    });

    it('does not run a cleanup when there are no orphans', async () => {
      Bookmark.find.mockReturnValue(
        mockQuery([{ _id: 'b1', createdAt: new Date(), thread: { _id: threadId } }]),
      );

      await listBookmarks(userId);

      expect(Bookmark.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('listBookmarkedThreadIds', () => {
    it('returns an empty array without querying threads when nothing is saved', async () => {
      Bookmark.find.mockReturnValue(mockQuery([]));

      await expect(listBookmarkedThreadIds(userId)).resolves.toEqual([]);
      expect(Thread.find).not.toHaveBeenCalled();
    });

    it('returns only ids of threads that still exist', async () => {
      const kept = new mongoose.Types.ObjectId();
      const deleted = new mongoose.Types.ObjectId();
      const bookmarkQuery = mockQuery([{ thread: kept }, { thread: deleted }]);
      const threadQuery = mockQuery([kept], 'distinct');
      Bookmark.find.mockReturnValue(bookmarkQuery);
      Thread.find.mockReturnValue(threadQuery);

      const result = await listBookmarkedThreadIds(userId);

      expect(bookmarkQuery.select).toHaveBeenCalledWith('thread');
      expect(Thread.find).toHaveBeenCalledWith({ _id: { $in: [kept, deleted] } });
      expect(threadQuery.distinct).toHaveBeenCalledWith('_id');
      expect(result).toEqual([kept.toString()]);
    });
  });
});
