import mongoose from "mongoose";
import Bookmark from "../models/Bookmark.js";
import Thread from "../models/Thread.js";
import { createAppError } from "../utils/createAppError.js";

const DUPLICATE_KEY_ERROR = 11000;

// Only the fields the UI needs. upvotedBy/downvotedBy are deliberately excluded.
const THREAD_FIELDS =
  "title content voteCount upvotes downvotes createdAt author subreddit";

// isObjectIdOrHexString only accepts 24-char hex strings or ObjectIds;
// mongoose.isValidObjectId would also accept any 12-character string.
const assertValidThreadId = (threadId) => {
  if (!mongoose.isObjectIdOrHexString(threadId)) {
    throw createAppError("Invalid thread id", 400);
  }
};

// A populated author or subreddit can be null (e.g. the user was deleted).
// That only blanks the field; the thread itself still exists, so it is kept.
const toRef = (doc) => (doc ? { _id: doc._id, name: doc.name } : null);

const toSavedThread = ({ thread, createdAt }) => ({
  _id: thread._id,
  title: thread.title,
  content: thread.content,
  voteCount: thread.voteCount,
  upvotes: thread.upvotes,
  downvotes: thread.downvotes,
  createdAt: thread.createdAt,
  author: toRef(thread.author),
  subreddit: toRef(thread.subreddit),
  savedAt: createdAt,
});

export const listBookmarks = async (userId) => {
  const bookmarks = await Bookmark.find({ user: userId })
    .sort({ createdAt: -1 })
    .populate({
      path: "thread",
      select: THREAD_FIELDS,
      populate: [
        { path: "author", select: "name" },
        { path: "subreddit", select: "name" },
      ],
    })
    .lean();

  // A bookmark whose thread was deleted populates to null: drop it from the
  // response and clean it up so it stops being counted anywhere.
  const orphanIds = bookmarks.filter((b) => !b.thread).map((b) => b._id);
  if (orphanIds.length > 0) {
    await Bookmark.deleteMany({ _id: { $in: orphanIds } });
  }

  return bookmarks.filter((b) => b.thread).map(toSavedThread);
};

export const listBookmarkedThreadIds = async (userId) => {
  const bookmarks = await Bookmark.find({ user: userId }).select("thread").lean();
  if (bookmarks.length === 0) {
    return [];
  }

  // Exclude threads that no longer exist, so the client never counts them.
  const existingIds = await Thread.find({
    _id: { $in: bookmarks.map((b) => b.thread) },
  }).distinct("_id");

  return existingIds.map((id) => id.toString());
};

export const saveBookmark = async (userId, threadId) => {
  assertValidThreadId(threadId);

  const threadExists = await Thread.exists({ _id: threadId });
  if (!threadExists) {
    throw createAppError("Thread not found", 404);
  }

  let bookmark;
  try {
    // Idempotent: inserts on the first save, returns the existing document
    // afterwards. Timestamps put createdAt in $setOnInsert, so a repeat save
    // keeps the original savedAt.
    bookmark = await Bookmark.findOneAndUpdate(
      { user: userId, thread: threadId },
      { $setOnInsert: { user: userId, thread: threadId } },
      { upsert: true, new: true },
    );
  } catch (err) {
    // Two concurrent upserts can both try to insert; the loser hits the unique
    // index. The bookmark exists either way, so treat it as already saved.
    if (err?.code !== DUPLICATE_KEY_ERROR) {
      throw err;
    }
    bookmark = await Bookmark.findOne({ user: userId, thread: threadId });
  }

  return { threadId, saved: true, savedAt: bookmark.createdAt };
};

export const removeBookmark = async (userId, threadId) => {
  assertValidThreadId(threadId);

  // Idempotent, and deliberately does not require the thread to exist, so a
  // bookmark of a deleted thread can still be removed.
  await Bookmark.deleteOne({ user: userId, thread: threadId });

  return { threadId, saved: false };
};
