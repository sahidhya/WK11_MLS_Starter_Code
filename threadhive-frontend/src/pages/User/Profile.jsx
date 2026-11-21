import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Container, Card, Row, Col, Form, Button, Tabs, Tab, Spinner, Alert } from "react-bootstrap";
import { useSelector, useDispatch } from "react-redux";
import { setUser } from "../../reducers/authSlice";
import {
  fetchSavedThreads,
  retryFailedBookmarkIds,
  selectSavedCount,
  selectSavedThreads,
  selectThreadsStatus,
  selectThreadsError,
} from "../../reducers/bookmarkSlice";
import ThreadList from "../../components/ThreadList/ThreadList";
import PaginationComponent from "../../components/Shared/PaginationComponent";
import "./Profile.css";

const SAVED_PAGE_SIZE = 5;

// Mounted each time the Saved tab opens (the tabs use unmountOnExit), so the
// list is reloaded on every visit.
function SavedThreadsPanel() {
  const dispatch = useDispatch();
  const savedThreads = useSelector(selectSavedThreads);
  const status = useSelector(selectThreadsStatus);
  const error = useSelector(selectThreadsError);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    dispatch(fetchSavedThreads());
  }, [dispatch]);

  if (status === "failed") {
    return (
      <Alert variant="danger" className="d-flex flex-wrap align-items-center justify-content-between gap-2">
        <span>Couldn&apos;t load your saved threads. {error}</span>
        <Button variant="outline-danger" size="sm" onClick={() => dispatch(fetchSavedThreads())}>
          Retry
        </Button>
      </Alert>
    );
  }

  if (status !== "succeeded") {
    return (
      <div className="text-center py-4">
        <Spinner animation="border" size="sm" role="status">
          <span className="visually-hidden">Loading saved threads...</span>
        </Spinner>
      </div>
    );
  }

  if (savedThreads.length === 0) {
    return (
      <div className="text-center py-4" style={{ color: "var(--text-muted)" }}>
        <p className="mb-2">You haven&apos;t saved any threads yet.</p>
        <Link to="/home">Browse the home feed</Link>
      </div>
    );
  }

  // Clamp rather than store: unsaving the last item on the last page moves
  // the view back a page automatically.
  const totalPages = Math.ceil(savedThreads.length / SAVED_PAGE_SIZE);
  const page = Math.min(currentPage, totalPages);
  const start = (page - 1) * SAVED_PAGE_SIZE;

  return (
    <>
      <ThreadList threadsToDisplay={savedThreads.slice(start, start + SAVED_PAGE_SIZE)} />
      <PaginationComponent currentPage={page} totalPages={totalPages} onPageChange={setCurrentPage} />
    </>
  );
}

function Profile() {
  const dispatch = useDispatch();
  const user = useSelector((state) => state.auth.user) ?? {};
  const savedCount = useSelector(selectSavedCount);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Anything other than ?tab=saved (including a missing or unknown value) shows Details.
  const activeTab = searchParams.get("tab") === "saved" ? "saved" : "details";

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: user.name ?? "",
    email: user.email ?? "",
    bio: user.bio ?? "",
    location: user.location ?? "",
    website: user.website ?? "",
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSave = () => {
    dispatch(setUser(form));
    setEditing(false);
  };

  // If the saved ids failed to load at startup, retry once so the "Saved (N)"
  // count is right whichever tab opens first.
  useEffect(() => {
    dispatch(retryFailedBookmarkIds());
  }, [dispatch]);

  const handleTabSelect = (key) => {
    setSearchParams(key === "saved" ? { tab: "saved" } : {});
  };

  return (
    <Container className="mt-3 mb-4">
      <Button variant="link" className="profile-back-btn p-0" onClick={() => navigate('/home')}>
        ← Back to Home
      </Button>

      <Card className="profile-card border-0 shadow-sm">
        <Card.Body>
          <div className="profile-header">
            <div className="profile-avatar-section">
              <div className="profile-avatar">
                {form.name?.charAt(0).toUpperCase() ?? "U"}
              </div>
            </div>
            <div className="profile-info-section">
              <div className="profile-title-row">
                <h2 className="profile-name">{form.name ?? "User"}</h2>
                {activeTab === "details" && (
                  <div>
                    {editing ? (
                      <>
                        <Button variant="success" size="sm" className="me-2" onClick={handleSave}>
                          ✓ Save
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
                          ✕ Cancel
                        </Button>
                      </>
                    ) : (
                      <Button variant="primary" size="sm" onClick={() => setEditing(true)}>
                        ✏️ Edit Profile
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <Tabs
            id="profile-tabs"
            activeKey={activeTab}
            onSelect={handleTabSelect}
            transition={false}
            mountOnEnter
            unmountOnExit
            className="mb-3"
          >
            <Tab eventKey="details" title="Details">
              {!editing ? (
                <div className="profile-fields">
                  <div className="profile-field">
                    <div className="profile-field-label">Full Name</div>
                    <p className="profile-field-value">{form.name ?? <span className="empty">Not provided</span>}</p>
                  </div>
                  <div className="profile-field">
                    <div className="profile-field-label">Email Address</div>
                    <p className="profile-field-value">{form.email ?? <span className="empty">Not provided</span>}</p>
                  </div>
                  <div className="profile-field" style={{ gridColumn: '1 / -1' }}>
                    <div className="profile-field-label">Bio</div>
                    <p className="profile-field-value">{form.bio ?? <span className="empty">No bio added yet</span>}</p>
                  </div>
                  <div className="profile-field">
                    <div className="profile-field-label">Location</div>
                    <p className="profile-field-value">{form.location ?? <span className="empty">Not provided</span>}</p>
                  </div>
                  <div className="profile-field">
                    <div className="profile-field-label">Website</div>
                    <p className="profile-field-value">{form.website ?? <span className="empty">Not provided</span>}</p>
                  </div>
                </div>
              ) : (
                <Form>
                  <Row>
                    <Col md={6} className="mb-3">
                      <Form.Label className="profile-field-label">Full Name</Form.Label>
                      <Form.Control
                        className="profile-form-control"
                        name="name"
                        value={form.name}
                        onChange={handleChange}
                      />
                    </Col>
                    <Col md={6} className="mb-3">
                      <Form.Label className="profile-field-label">Email Address</Form.Label>
                      <Form.Control
                        className="profile-form-control"
                        name="email"
                        value={form.email}
                        disabled
                        title="Email cannot be changed"
                      />
                    </Col>
                    <Col md={12} className="mb-3">
                      <Form.Label className="profile-field-label">Bio</Form.Label>
                      <Form.Control
                        className="profile-form-control"
                        as="textarea"
                        rows={3}
                        name="bio"
                        value={form.bio}
                        onChange={handleChange}
                        placeholder="Tell us about yourself..."
                      />
                    </Col>
                    <Col md={6} className="mb-3">
                      <Form.Label className="profile-field-label">Location</Form.Label>
                      <Form.Control
                        className="profile-form-control"
                        name="location"
                        value={form.location}
                        onChange={handleChange}
                        placeholder="City, Country"
                      />
                    </Col>
                    <Col md={6} className="mb-3">
                      <Form.Label className="profile-field-label">Website</Form.Label>
                      <Form.Control
                        className="profile-form-control"
                        name="website"
                        value={form.website}
                        onChange={handleChange}
                        placeholder="https://..."
                      />
                    </Col>
                  </Row>
                </Form>
              )}
            </Tab>
            <Tab eventKey="saved" title={`Saved (${savedCount})`}>
              <SavedThreadsPanel />
            </Tab>
          </Tabs>
        </Card.Body>
      </Card>
    </Container>
  );
}

export default Profile;
