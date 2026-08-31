import { useEffect, useState, type FormEvent } from "react";
import { portalFetch, usePublishContext } from "@portal/runtime";

type Me = { displayName: string | null; email: string | null };
type Profile = { bio: string | null; avatarUrl: string | null };
type Status = "loading" | "ready" | "saving" | "error";

export function ProfileView() {
  const publishProfile = usePublishContext("profile");
  const [me, setMe] = useState<Me | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [status, setStatus] = useState<Status>("loading");

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
    publishProfile({ displayName: me.displayName, avatarUrl: profile.avatarUrl });
  }, [me, profile, publishProfile]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setStatus("saving");
    try {
      const response = await portalFetch("/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bio, avatarUrl }),
      });
      if (!response.ok) {
        setStatus("error");
        return;
      }
      const updated = (await response.json()) as Profile;
      setProfile(updated);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }

  if (status === "loading") return <div>Loading…</div>;
  if (status === "error") return <div>Something went wrong loading your profile.</div>;

  return (
    <div>
      <h1>{me?.displayName ?? me?.email ?? "Your profile"}</h1>
      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
      >
        <label>
          Bio
          <textarea value={bio} onChange={(event) => setBio(event.target.value)} />
        </label>
        <label>
          Avatar URL
          <input value={avatarUrl} onChange={(event) => setAvatarUrl(event.target.value)} />
        </label>
        <button type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Saving…" : "Save"}
        </button>
      </form>
    </div>
  );
}
