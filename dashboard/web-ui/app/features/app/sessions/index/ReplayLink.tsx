import type { AnchorHTMLAttributes } from 'react';
import { Link } from 'react-router';

type ReplayLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick'> & {
    to: string;
    disabled?: boolean;
};

// Let the browser handle context menus, Cmd/Ctrl-click, and middle-click.
// Stopping propagation only prevents the surrounding row from expanding.
export function ReplayLink({ to, disabled, children, ...props }: ReplayLinkProps) {
    if (disabled) {
        return <span {...props} role="link" aria-disabled="true" onClick={(event) => event.stopPropagation()}>{children}</span>;
    }
    return <Link {...props} to={to} onClick={(event) => event.stopPropagation()}>{children}</Link>;
}
