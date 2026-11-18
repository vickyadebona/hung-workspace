import { Workspace } from './access';
import { allowedEmails } from './auth';
import { getStore } from './store';

/** The access layer for one signed-in person. Create one per request. */
export function workspaceFor(user: { email: string; name: string }): Workspace {
  return new Workspace(getStore(), user, allowedEmails());
}
