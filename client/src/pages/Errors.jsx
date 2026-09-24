import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/ui.jsx';

export function Forbidden() {
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title="Not available to your role" />
      <div className="card">
        <div className="card-body">
          <p style={{ marginTop: 0 }}>
            Your role does not include this screen. That is a permission decision, not a fault - the
            server would refuse the request even if the page opened.
          </p>
          <p className="muted">
            If you need it, ask the administrator to grant the relevant permission to your role.
            Sharing another person&apos;s account is not a workaround: every document records who
            entered it.
          </p>
          <div className="row">
            <button type="button" className="btn" onClick={() => navigate(-1)}>
              Go back
            </button>
            <Link className="btn btn-primary" to="/">
              Dashboard
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}

export function NotFound() {
  return (
    <>
      <PageHeader title="Page not found" />
      <div className="card">
        <div className="card-body">
          <p style={{ marginTop: 0 }}>There is no screen at this address.</p>
          <p className="muted">
            The application covers Masters through to Cutting Issue. Stages beyond Cutting Issue -
            stitching, QC records, packing and dispatch - are not part of this system.
          </p>
          <Link className="btn btn-primary" to="/">
            Dashboard
          </Link>
        </div>
      </div>
    </>
  );
}
