import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';
import { initials } from '../lib/format.js';
import { thumb } from '../lib/youtube.js';

export function Button({ variant = 'default', size, block, loading, children, className = '', icon, ...props }) {
  const cls = ['btn', variant !== 'default' && `btn-${variant}`, size && `btn-${size}`, block && 'btn-block', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={cls} disabled={loading || props.disabled} aria-busy={loading || undefined} {...props}>
      {loading ? <span className="spinner" style={{ width: 16, height: 16 }} aria-hidden="true" /> : icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  );
}

export function ButtonLink({ variant = 'default', size, block, children, icon, className = '', ...props }) {
  const cls = ['btn', variant !== 'default' && `btn-${variant}`, size && `btn-${size}`, block && 'btn-block', className]
    .filter(Boolean)
    .join(' ');
  return (
    <Link className={cls} {...props}>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </Link>
  );
}

export function Field({ label, hint, error, children, id: idProp }) {
  const auto = useId();
  const id = idProp || auto;
  const describedBy = [hint && `${id}-hint`, error && `${id}-err`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      {label && (
        <label className="label" htmlFor={id}>
          {label}
        </label>
      )}
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? 'true' : undefined })}
      {hint && !error && (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
      {error && (
        <span className="field-error" id={`${id}-err`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export function Switch({ checked, onChange, label, description, disabled }) {
  return (
    <label className="switch">
      <span className="switch-text">
        <span className="label">{label}</span>
        {description && <span className="hint">{description}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
    </label>
  );
}

export function Avatar({ user, size = 32, online }) {
  return (
    <span
      className="avatar"
      style={{ '--size': `${size}px`, background: user?.avatarColor || '#888' }}
      aria-hidden="true"
      title={user?.displayName}
    >
      {initials(user?.displayName)}
      {online !== undefined && <span className={`presence ${online ? 'on' : ''}`} />}
    </span>
  );
}

export function Spinner({ large, label = 'Loading' }) {
  return <span className={`spinner ${large ? 'spinner-lg' : ''}`} role="status" aria-label={label} />;
}

export function PageLoading({ label }) {
  return (
    <div className="page-loading">
      <Spinner large label={label} />
    </div>
  );
}

export function State({ icon = 'film', title, children, actions }) {
  return (
    <div className="state">
      <div className="state-mark">
        <Icon name={icon} size={26} />
      </div>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {actions && <div className="state-actions">{actions}</div>}
    </div>
  );
}

/** YouTube thumbnail with fallback: maxres isn't generated for every video. */
export function Thumb({ id, alt = '', quality = 'maxresdefault', eager }) {
  return (
    <img
      src={thumb(id, quality)}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={(e) => {
        const img = e.currentTarget;
        if (!img.dataset.fallback) {
          img.dataset.fallback = '1';
          img.src = thumb(id, 'hqdefault');
        }
      }}
      onLoad={(e) => {
        // YouTube returns a 120×90 grey placeholder instead of a 404 for missing maxres images.
        const img = e.currentTarget;
        if (img.naturalWidth === 120 && !img.dataset.fallback) {
          img.dataset.fallback = '1';
          img.src = thumb(id, 'hqdefault');
        }
      }}
    />
  );
}

export function Modal({ title, children, onClose, actions, labelledBy, wide }) {
  const ref = useRef(null);
  const headingId = useId();
  useEffect(() => {
    const prev = document.activeElement;
    const node = ref.current;
    const focusables = () =>
      node.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    focusables()[0]?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const list = Array.from(focusables());
        if (!list.length) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy || headingId} ref={ref}>
        {title && <h2 id={headingId}>{title}</h2>}
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>,
    document.body
  );
}
