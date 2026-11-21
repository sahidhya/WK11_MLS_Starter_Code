import { useDispatch } from 'react-redux';
import { upvoteThreadThunk, downvoteThreadThunk } from '../../reducers/threadSlice';
import { Link } from 'react-router-dom';
import { Container } from "react-bootstrap";
import VoteButtons from '../Shared/VoteButtons';
import BookmarkButton from '../Shared/BookmarkButton';
import { formatRelativeTime } from '../../utils/formatRelativeTime';
import './ThreadList.css';

export default function ThreadList({ threadsToDisplay }) {
  const dispatch = useDispatch();

  const handleUpvote = (threadId) => {
    dispatch(upvoteThreadThunk(threadId));
  };

  const handleDownvote = (threadId) => {
    dispatch(downvoteThreadThunk(threadId));
  };

  return (
    <Container fluid className="px-0">
      {threadsToDisplay.map((thread) => (
        <div key={thread._id} className="thread-card">
          <div className="thread-card-body">
            {/* Voting Section */}
            <div className="vote-section">
              <VoteButtons
                count={thread.voteCount}
                onUpvote={() => handleUpvote(thread._id)}
                onDownvote={() => handleDownvote(thread._id)}
              />
            </div>

            {/* Thread Info */}
            <div className="thread-content-section">
              <div className="thread-header">
                <h5 className="thread-title">{thread.title}</h5>
                <div className="d-flex align-items-center gap-2 flex-shrink-0">
                  {/* Only Saved-tab data carries savedAt */}
                  {thread.savedAt && (
                    <span className="small" style={{ color: 'var(--text-muted)' }}>
                      saved {formatRelativeTime(thread.savedAt)}
                    </span>
                  )}
                  <span className="subreddit-badge">
                    r/{thread.subreddit?.name || 'unknown'}
                  </span>
                  <BookmarkButton threadId={thread._id} />
                </div>
              </div>
              <p className="thread-text">{thread.content}</p>
              <Link
                to={`/thread/${thread._id}`}
                className="view-thread-btn"
              >
                💬 View Comments
              </Link>
            </div>
          </div>
        </div>
      ))}
    </Container>
  );
}
