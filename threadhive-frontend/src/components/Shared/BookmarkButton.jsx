import { useDispatch, useSelector } from 'react-redux';
import { Button } from 'react-bootstrap';
import { toggleBookmark, selectIsSaved, selectIsPending } from '../../reducers/bookmarkSlice';

export default function BookmarkButton({ threadId }) {
  const dispatch = useDispatch();
  const isSaved = useSelector((state) => selectIsSaved(state, threadId));
  const isPending = useSelector((state) => selectIsPending(state, threadId));
  const label = isSaved ? 'Unsave thread' : 'Save thread';

  return (
    <Button
      variant="link"
      size="sm"
      className="bookmark-btn p-0 lh-1"
      style={{ color: 'var(--primary-blue)', fontSize: '1.1rem' }}
      onClick={() => dispatch(toggleBookmark({ threadId, save: !isSaved }))}
      disabled={isPending}
      aria-pressed={isSaved}
      aria-label={label}
      title={label}
    >
      <i className={isSaved ? 'bi bi-bookmark-fill' : 'bi bi-bookmark'} aria-hidden="true"></i>
    </Button>
  );
}
