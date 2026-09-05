import test from "node:test";
import assert from "node:assert/strict";

import {
  SIDEBAR_COLLAPSE_STORAGE_KEY,
  parseSidebarCollapsePreference,
  resolveSidebarCollapseForViewport,
  serializeSidebarCollapsePreference,
} from "../lib/sidebar-preference.ts";

test("the stored key and value format are unchanged", () => {
  assert.equal(SIDEBAR_COLLAPSE_STORAGE_KEY, "shift-canvas-sidebar-collapsed");
  assert.equal(serializeSidebarCollapsePreference(true), "true");
  assert.equal(serializeSidebarCollapsePreference(false), "false");
  assert.equal(parseSidebarCollapsePreference("true"), true);
  assert.equal(parseSidebarCollapsePreference("false"), false);
  assert.equal(parseSidebarCollapsePreference(null), false);
  assert.equal(parseSidebarCollapsePreference("garbage"), false);
});

test("resizing without crossing the breakpoint leaves the live preference alone", () => {
  // The regression: a desktop resize used to re-apply the preference read at
  // mount, discarding a collapse the user had just chosen.
  assert.equal(
    resolveSidebarCollapseForViewport({
      isMobileSidebarMode: false,
      wasMobileSidebarMode: false,
      storedPreference: "false",
    }),
    null,
  );

  assert.equal(
    resolveSidebarCollapseForViewport({
      isMobileSidebarMode: true,
      wasMobileSidebarMode: true,
      storedPreference: "true",
    }),
    null,
  );
});

test("mount applies the stored preference", () => {
  assert.equal(
    resolveSidebarCollapseForViewport({
      isMobileSidebarMode: false,
      wasMobileSidebarMode: null,
      storedPreference: "true",
    }),
    true,
  );

  assert.equal(
    resolveSidebarCollapseForViewport({
      isMobileSidebarMode: false,
      wasMobileSidebarMode: null,
      storedPreference: null,
    }),
    false,
  );
});

test("crossing into mobile expands, and coming back restores the desktop choice", () => {
  const storedPreference = serializeSidebarCollapsePreference(true);

  assert.equal(
    resolveSidebarCollapseForViewport({
      isMobileSidebarMode: true,
      wasMobileSidebarMode: false,
      storedPreference,
    }),
    false,
  );

  // Storage still holds the desktop choice, because the persisting effect
  // skips mobile mode.
  assert.equal(
    resolveSidebarCollapseForViewport({
      isMobileSidebarMode: false,
      wasMobileSidebarMode: true,
      storedPreference,
    }),
    true,
  );
});

test("a preference set after mount survives a full mobile round trip", () => {
  // Loads expanded, user collapses, storage is rewritten by the effect.
  let stored = serializeSidebarCollapsePreference(false);
  let wasMobile: boolean | null = null;

  assert.equal(
    resolveSidebarCollapseForViewport({
      isMobileSidebarMode: false,
      wasMobileSidebarMode: wasMobile,
      storedPreference: stored,
    }),
    false,
  );
  wasMobile = false;

  stored = serializeSidebarCollapsePreference(true);

  // Down to mobile, then back up.
  assert.equal(
    resolveSidebarCollapseForViewport({
      isMobileSidebarMode: true,
      wasMobileSidebarMode: wasMobile,
      storedPreference: stored,
    }),
    false,
  );
  wasMobile = true;

  assert.equal(
    resolveSidebarCollapseForViewport({
      isMobileSidebarMode: false,
      wasMobileSidebarMode: wasMobile,
      storedPreference: stored,
    }),
    true,
  );
});
