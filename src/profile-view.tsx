import { useEffect, useRef, useState, type FormEvent } from "react";
import { portalFetch, usePublishContext } from "@portal/runtime";

type Me = { displayName: string | null; email: string | null };
type Profile = { bio: string | null; avatarUrl: string | null };
type Status = "loading" | "ready" | "saving" | "error";

export function ProfileView() {
  const publishProfile = usePublishContext("profile");
  // The real usePublishContext's returned function may not have a stable
  // identity across renders (this component's own dev/test-only stub
  // doesn't guarantee one either) — routing every call through a ref means
  // the publish effect below only needs to depend on [me, profile], not on
  // publishProfile itself, so it can't re-fire on every unrelated render.
  const publishProfileRef = useRef(publishProfile);
  publishProfileRef.current = publishProfile;
  const [me, setMe] = useState<Me | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [status, setStatus] = useState<Status>("loading");
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [meResponse, profileResponse] = await Promise.all([portalFetch("/me"), portalFetch("/profile")]);
        if (!meResponse.ok || !profileResponse.ok) {
          setStatus("error");
          return;
        }
        const meJson = (await meResponse.json()) as Me;
        const profileJson = (await profileResponse.json()) as Profile;
        setMe(meJson);
        setProfile(profileJson);
        setBio(profileJson.bio ?? "");
        setAvatarUrl(profileJson.avatarUrl ?? "");
        setStatus("ready");
      } catch {
        setStatus("error");
      }
    })();
  }, []);

  useEffect(() => {
    if (!me || !profile) return;
    publishProfileRef.current({ displayName: me.displayName, avatarUrl: profile.avatarUrl });
  }, [me, profile]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setStatus("saving");
    setSaveError(false);
    try {
      // An empty field means "no bio"/"no avatar" — send null so it's
      // actually cleared server-side (an empty string is a value, not the
      // same as omitting/clearing the field; see specification.md, Data
      // ownership). This also matters now that the server validates a
      // non-null avatarUrl as a real http(s) URL — "" would fail that
      // check.
      const response = await portalFetch("/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bio: bio === "" ? null : bio,
          avatarUrl: avatarUrl === "" ? null : avatarUrl,
        }),
      });
      if (!response.ok) {
        setSaveError(true);
        setStatus("ready");
        return;
      }
      const updated = (await response.json()) as Profile;
      setProfile(updated);
      setBio(updated.bio ?? "");
      setAvatarUrl(updated.avatarUrl ?? "");
      setStatus("ready");
    } catch {
      setSaveError(true);
      setStatus("ready");
    }
  }

  if (status === "loading") return <div>Loading…</div>;
  if (status === "error") return <div>Something went wrong loading your profile.</div>;

  const fieldStyle = {
    border: "var(--portal-border-width, 1px) solid var(--portal-color-border, #ddd)",
    borderRadius: "var(--portal-radius, 6px)",
    padding: "var(--portal-space-2, 0.5rem)",
  };

  return (
    <div className="portal-flex portal-flex-col portal-gap-4">
      <h1 style={{ color: "var(--portal-color-text, #1a1a1a)" }}>
        {me?.displayName ?? me?.email ?? "Your profile"}
      </h1>
      {saveError && (
        <p style={{ color: "var(--portal-color-danger, #b91c1c)" }}>
          Could not save your changes. Please try again.
        </p>
      )}
      <form
        className="portal-flex portal-flex-col portal-gap-4"
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <label className="portal-flex portal-flex-col portal-gap-1">
          Bio
          <textarea style={fieldStyle} value={bio} onChange={(event) => setBio(event.target.value)} />
        </label>
        <label className="portal-flex portal-flex-col portal-gap-1">
          Avatar URL
          <input style={fieldStyle} value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} />
        </label>
        <button
          type="submit"
          disabled={status === "saving"}
          style={{
            background: "var(--portal-color-primary, #4338ca)",
            color: "var(--portal-color-primary-contrast, #fff)",
            border: "none",
            borderRadius: "var(--portal-radius, 6px)",
            padding: "var(--portal-space-2, 0.5rem)",
          }}
        >
          {status === "saving" ? "Saving…" : "Save"}
        </button>
      </form>
    </div>
  );
}
