/** One entry of public/registry.json — UI catalogue only; access policy lives in mvv42-auth. */
export interface Service {
  /** Shared id with mvv42-auth `apps.id`; also the URL prefix (`/<id>/`). */
  id: string;
  name: string;
  description: string;
  /** Tabler icon name (see src/components/icons.ts); unknown → first letter, legacy emoji → as text. */
  icon: string;
  /** Mount path with trailing slash, e.g. "/cashpulse/". */
  path: string;
  /** Tile colour (only used on the service icon). */
  color: string;
  /**
   * `"shared"` once the service uses mvv42-auth (shell may lock its tile and handle login).
   * Absent = the service still has its own login: the shell never locks it.
   */
  auth?: 'shared';
}

export interface Registry {
  version: number;
  services: Service[];
}
