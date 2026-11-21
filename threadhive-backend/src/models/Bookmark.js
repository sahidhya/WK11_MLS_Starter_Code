import mongoose from "mongoose";

// A user's saved thread. One document per (user, thread) pair; createdAt is
// exposed to clients as `savedAt`.
const BookmarkSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    thread: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Thread",
      required: true,
    },
  },
  { timestamps: true },
);

// Enforces "saved at most once" at the database level, so concurrent saves
// cannot create duplicates.
BookmarkSchema.index({ user: 1, thread: 1 }, { unique: true });
// Serves the "my bookmarks, newest first" listing.
BookmarkSchema.index({ user: 1, createdAt: -1 });

const Bookmark = mongoose.model("Bookmark", BookmarkSchema);

export default Bookmark;
