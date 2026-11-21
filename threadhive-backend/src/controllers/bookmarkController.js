import * as bookmarkService from "../services/bookmarkService.js";

// GET /api/bookmarks
export const getBookmarks = async (req, res) => {
  const bookmarks = await bookmarkService.listBookmarks(req.user.userId);
  res.status(200).json({
    success: true,
    message: "Bookmarks fetched successfully",
    data: bookmarks,
  });
};

// GET /api/bookmarks/ids
export const getBookmarkIds = async (req, res) => {
  const ids = await bookmarkService.listBookmarkedThreadIds(req.user.userId);
  res.status(200).json({
    success: true,
    message: "Bookmark ids fetched successfully",
    data: ids,
  });
};

// PUT /api/bookmarks/:threadId
export const saveBookmark = async (req, res) => {
  const result = await bookmarkService.saveBookmark(
    req.user.userId,
    req.params.threadId,
  );
  res.status(200).json({
    success: true,
    message: "Thread saved",
    data: result,
  });
};

// DELETE /api/bookmarks/:threadId
export const unsaveBookmark = async (req, res) => {
  const result = await bookmarkService.removeBookmark(
    req.user.userId,
    req.params.threadId,
  );
  res.status(200).json({
    success: true,
    message: "Thread unsaved",
    data: result,
  });
};
