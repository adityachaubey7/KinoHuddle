import { useLocation } from 'react-router-dom';
import { ButtonLink } from '../components/ui.jsx';

export default function NotFound() {
  const { pathname } = useLocation();
  return (
    <div className="notfound">
      <div className="big" aria-hidden="true">404</div>
      <h1>This reel is missing</h1>
      <p>
        There’s nothing at <code style={{ color: 'var(--paper)' }}>{pathname}</code>. If someone sent you a room link, check it was copied in full.
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <ButtonLink to="/" variant="primary">Browse titles</ButtonLink>
        <ButtonLink to="/join" variant="ghost">Enter a room code</ButtonLink>
      </div>
    </div>
  );
}
