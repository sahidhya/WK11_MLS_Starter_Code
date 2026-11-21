import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getBookmarks,
  getBookmarkIds,
  saveBookmark,
  unsaveBookmark,
} from '../../../src/controllers/bookmarkController.js';
import * as bookmarkService from '../../../src/services/bookmarkService.js';

vi.mock('../../../src/services/bookmarkService.js');

describe('bookmarkController', () => {
  let req, res;

  beforeEach(() => {
    vi.clearAllMocks();
    req = { params: {}, body: {}, user: { userId: 'user123' } };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
  });

  describe('getBookmarks', () => {
    it("returns the user's saved threads", async () => {
      const saved = [{ _id: 't1', title: 'Thread', savedAt: '2026-11-21T10:00:00.000Z' }];
      bookmarkService.listBookmarks.mockResolvedValue(saved);

      await getBookmarks(req, res);

      expect(bookmarkService.listBookmarks).toHaveBeenCalledWith('user123');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Bookmarks fetched successfully',
        data: saved,
      });
    });

    it('propagates service errors', async () => {
      bookmarkService.listBookmarks.mockRejectedValue(new Error('Database error'));

      await expect(getBookmarks(req, res)).rejects.toThrow('Database error');
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('getBookmarkIds', () => {
    it("returns the user's saved thread ids", async () => {
      bookmarkService.listBookmarkedThreadIds.mockResolvedValue(['t1', 't2']);

      await getBookmarkIds(req, res);

      expect(bookmarkService.listBookmarkedThreadIds).toHaveBeenCalledWith('user123');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Bookmark ids fetched successfully',
        data: ['t1', 't2'],
      });
    });
  });

  describe('saveBookmark', () => {
    it('saves the thread for the logged-in user', async () => {
      req.params.threadId = 'thread123';
      const result = { threadId: 'thread123', saved: true, savedAt: '2026-11-21T10:00:00.000Z' };
      bookmarkService.saveBookmark.mockResolvedValue(result);

      await saveBookmark(req, res);

      expect(bookmarkService.saveBookmark).toHaveBeenCalledWith('user123', 'thread123');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Thread saved', data: result });
    });

    it('takes the user from the token, not the request body', async () => {
      req.params.threadId = 'thread123';
      req.body = { user: 'someone-else' };
      bookmarkService.saveBookmark.mockResolvedValue({});

      await saveBookmark(req, res);

      expect(bookmarkService.saveBookmark).toHaveBeenCalledWith('user123', 'thread123');
    });

    it('propagates service errors with their status code', async () => {
      req.params.threadId = 'missing';
      const error = Object.assign(new Error('Thread not found'), { statusCode: 404 });
      bookmarkService.saveBookmark.mockRejectedValue(error);

      await expect(saveBookmark(req, res)).rejects.toMatchObject({
        message: 'Thread not found',
        statusCode: 404,
      });
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('unsaveBookmark', () => {
    it('removes the thread for the logged-in user', async () => {
      req.params.threadId = 'thread123';
      const result = { threadId: 'thread123', saved: false };
      bookmarkService.removeBookmark.mockResolvedValue(result);

      await unsaveBookmark(req, res);

      expect(bookmarkService.removeBookmark).toHaveBeenCalledWith('user123', 'thread123');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true, message: 'Thread unsaved', data: result });
    });

    it('propagates service errors with their status code', async () => {
      req.params.threadId = 'abc';
      const error = Object.assign(new Error('Invalid thread id'), { statusCode: 400 });
      bookmarkService.removeBookmark.mockRejectedValue(error);

      await expect(unsaveBookmark(req, res)).rejects.toMatchObject({ statusCode: 400 });
    });
  });
});
