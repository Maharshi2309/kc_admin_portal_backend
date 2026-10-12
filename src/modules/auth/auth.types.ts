/** The signed-in staff user, as the app reads it (`auth.me.response.json`). */
export type AuthUserDto = {
  id: string;
  name: string;
  email: string;
  /** The user's own permission keys; the app uses them only to shape the UI. */
  permissions: string[];
};

/** `POST /auth/login` response (`auth.login.response.json`). */
export type LoginResponseDto = {
  accessToken: string;
  user: AuthUserDto;
};

/** Who is calling, resolved from the bearer token on every protected request. */
export type AuthContext = {
  userId: number;
  sessionId: string;
  name: string;
  email: string;
  /** Loaded per request, so permission changes apply immediately. */
  permissions: ReadonlySet<string>;
};
