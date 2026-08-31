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

  test("submitting the form POSTs the current field values and updates from the response", async () => {
    const originalFetch = globalThis.fetch;
    const postedBodies: string[] = [];
    globalThis.fetch = mock(async (input: any, init?: RequestInit) => {
      const url = String(input);
      if (url === "/me") {
        return new Response(JSON.stringify({ displayName: "Ada Lovelace", email: null }), { status: 200 });
      }
      if (url === "/profile" && init?.method === "POST") {
        postedBodies.push(String(init.body));
        return new Response(JSON.stringify({ bio: "Mathematician", avatarUrl: "https://example.com/a.png" }), {
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

      const form = container.querySelector("form") as HTMLFormElement;
      await act(async () => {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      await flush(act);

      expect(postedBodies).toHaveLength(1);
      expect(JSON.parse(postedBodies[0])).toEqual({ bio: "Mathematician", avatarUrl: "https://example.com/a.png" });

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
});
