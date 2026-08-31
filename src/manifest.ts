export const manifest = {
  name: "profile",
  bundle: "/.portal/bundle.js",
  routes: [{ path: "/profile", requiredRoles: [] as string[], methods: ["GET", "POST"], component: "ProfileView" }],
  nav: [{ label: "Profile", path: "/profile", requiredRoles: [] as string[] }],
  publishesContext: ["profile"] as string[],
  consumesContext: [] as string[],
};
