import { describe, test, expect, mock } from "bun:test";
import { withDom } from "./helpers/dom";

withDom();

async function flush(act: (callback: () => Promise<void>) => Promise<void>, times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("ProfileView", () => {
  test("references the shared theme's tokens with the correct literal fallbacks", async () => {
    // Not a DOM-rendering test — happy-dom's CSSStyleDeclaration silently
    // drops any style value containing var(...), so this checks the
    // component's own source text instead (same technique portal-frame.tsx's
    // own token test uses).
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(new URL("../src/profile-view.tsx", import.meta.url), "utf8");
    expect(source).toContain("var(--portal-color-text, #1a1a1a)");
    expect(source).toContain("var(--portal-color-danger, #b91c1c)");
    expect(source).toContain("var(--portal-color-border, #ddd)");
    expect(source).toContain("var(--portal-radius, 6px)");
    expect(source).toContain("var(--portal-space-2, 0.5rem)");
    expect(source).toContain("var(--portal-color-primary, #4338ca)");
    expect(source).toContain("var(--portal-color-primary-contrast, #fff)");
  });

  test("loads identity and profile data on mount and renders them", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (input: any) => {
      const url = String(input);
      if (url === "/me") {
        return new Response(JSON.stringify({ displayName: "Ada Lovelace", email: "ada@example.com" }), {
          status: 200,
        });
      }
      if (url === "/profile") {
        return new Response(JSON.stringify({ bio: "Mathematician", avatarUrl: "https://example.com/a.png" }), {
          status: 200,
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const { createRoot } = await import("react-dom/client");
      const { act } = await import("react");
      const { ProfileView } = await import("../src/profile-view");

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => {
        root.render(<ProfileView />);
      });
      await flush(act);

      expect(container.textContent).toContain("Ada Lovelace");
      const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
      expect(textarea.value).toBe("Mathematician");
      const input = container.querySelector("input") as HTMLInputElement;
      expect(input.value).toBe("https://example.com/a.png");

      await act(async () => {
        root.unmount();
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("shows an error state when the boot fetch fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;

    try {
      const { createRoot } = await import("react-dom/client");
      const { act } = await import("react");
      const { ProfileView } = await import("../src/profile-view");

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => {
        root.render(<ProfileView />);
      });
      await flush(act);

      expect(container.textContent).toContain("Something went wrong");

      await act(async () => {
        root.unmount();
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("submitting the form POSTs the current field values and syncs the fields from the (possibly normalized) response", async () => {
    const originalFetch = globalThis.fetch;
    const postedBodies: string[] = [];
    globalThis.fetch = mock(async (input: any, init?: RequestInit) => {
      const url = String(input);
      if (url === "/me") {
        return new Response(JSON.stringify({ displayName: "Ada Lovelace", email: null }), { status: 200 });
      }
      if (url === "/profile" && init?.method === "POST") {
        postedBodies.push(String(init.body));
        // Deliberately different from the GET response below, so this test
        // can only pass if the component actually syncs bio/avatarUrl from
        // the POST response rather than just re-displaying what it already
        // had loaded.
        return new Response(
          JSON.stringify({ bio: "Mathematician (verified)", avatarUrl: "https://cdn.example.com/a.png" }),
          { status: 200 }
        );
      }
      if (url === "/profile") {
        return new Response(JSON.stringify({ bio: "Mathematician", avatarUrl: "https://example.com/a.png" }), {
          status: 200,
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const { createRoot } = await import("react-dom/client");
      const { act } = await import("react");
      const { ProfileView } = await import("../src/profile-view");

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => {
        root.render(<ProfileView />);
      });
      await flush(act);

      const form = container.querySelector("form") as HTMLFormElement;
      await act(async () => {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      await flush(act);

      expect(postedBodies).toHaveLength(1);
      expect(JSON.parse(postedBodies[0])).toEqual({ bio: "Mathematician", avatarUrl: "https://example.com/a.png" });

      const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
      const input = container.querySelector("input") as HTMLInputElement;
      expect(textarea.value).toBe("Mathematician (verified)");
      expect(input.value).toBe("https://cdn.example.com/a.png");

      await act(async () => {
        root.unmount();
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a failed save preserves the user's edited field values and shows an inline error, without falling back to the full-page error view", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (input: any, init?: RequestInit) => {
      const url = String(input);
      if (url === "/me") {
        return new Response(JSON.stringify({ displayName: "Ada Lovelace", email: null }), { status: 200 });
      }
      if (url === "/profile" && init?.method === "POST") {
        return new Response("save failed", { status: 500 });
      }
      if (url === "/profile") {
        return new Response(JSON.stringify({ bio: "Original bio", avatarUrl: "https://example.com/original.png" }), {
          status: 200,
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const { createRoot } = await import("react-dom/client");
      const { act } = await import("react");
      const { ProfileView } = await import("../src/profile-view");

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => {
        root.render(<ProfileView />);
      });
      await flush(act);

      // Simulate the user editing the bio field, via React's native input
      // setter (a plain `textarea.value = "..."` assignment doesn't trigger
      // React's own change detection, since React tracks the previous value
      // through this same property descriptor).
      const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      await act(async () => {
        nativeSetter.call(textarea, "Edited but not yet saved");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });

      const form = container.querySelector("form") as HTMLFormElement;
      await act(async () => {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      await flush(act);

      expect(container.textContent).toContain("Could not save your changes");
      expect(container.textContent).not.toContain("Something went wrong loading your profile");
      expect(textarea.value).toBe("Edited but not yet saved");
      expect(container.querySelector("form")).not.toBeNull();

      await act(async () => {
        root.unmount();
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('publishes {displayName, avatarUrl} via usePublishContext("profile") only after both /me and /profile resolve', async () => {
    const { __publishedValues, __resetPublishedValuesForTests } = await import("../src/portal-runtime-stub");
    __resetPublishedValuesForTests();

    const originalFetch = globalThis.fetch;
    let resolveProfile: ((value: Response) => void) | null = null;
    const profileGate = new Promise<Response>((resolve) => {
      resolveProfile = resolve;
    });
    globalThis.fetch = mock(async (input: any) => {
      const url = String(input);
      if (url === "/me") {
        return new Response(JSON.stringify({ displayName: "Ada Lovelace", email: null }), { status: 200 });
      }
      if (url === "/profile") {
        return profileGate; // held open until the test releases it
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const { createRoot } = await import("react-dom/client");
      const { act } = await import("react");
      const { ProfileView } = await import("../src/profile-view");

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => {
        root.render(<ProfileView />);
      });
      await flush(act);

      // /me resolved, /profile still pending — must not have published yet
      expect(__publishedValues).toEqual([]);

      await act(async () => {
        resolveProfile!(
          new Response(JSON.stringify({ bio: "Mathematician", avatarUrl: "https://example.com/a.png" }), {
            status: 200,
          })
        );
      });
      await flush(act);

      expect(__publishedValues).toEqual([
        { key: "profile", value: { displayName: "Ada Lovelace", avatarUrl: "https://example.com/a.png" } },
      ]);

      await act(async () => {
        root.unmount();
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("clearing a field to empty and saving sends null for it, not an empty string", async () => {
    const originalFetch = globalThis.fetch;
    const postedBodies: string[] = [];
    globalThis.fetch = mock(async (input: any, init?: RequestInit) => {
      const url = String(input);
      if (url === "/me") {
        return new Response(JSON.stringify({ displayName: "Ada Lovelace", email: null }), { status: 200 });
      }
      if (url === "/profile" && init?.method === "POST") {
        postedBodies.push(String(init.body));
        return new Response(JSON.stringify({ bio: null, avatarUrl: "https://example.com/a.png" }), { status: 200 });
      }
      if (url === "/profile") {
        return new Response(JSON.stringify({ bio: "Mathematician", avatarUrl: "https://example.com/a.png" }), {
          status: 200,
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    try {
      const { createRoot } = await import("react-dom/client");
      const { act } = await import("react");
      const { ProfileView } = await import("../src/profile-view");

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => {
        root.render(<ProfileView />);
      });
      await flush(act);

      const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      await act(async () => {
        nativeSetter.call(textarea, "");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });

      const form = container.querySelector("form") as HTMLFormElement;
      await act(async () => {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      await flush(act);

      expect(postedBodies).toHaveLength(1);
      expect(JSON.parse(postedBodies[0])).toEqual({ bio: null, avatarUrl: "https://example.com/a.png" });

      await act(async () => {
        root.unmount();
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
