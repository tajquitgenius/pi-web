// The static export registers its toggle controller here so the Svelte message
// pane can reapply visibility state after branch navigation.
export const sessionRuntime = {
  toggleState: null,
};

export function resetSessionRuntime() {
  sessionRuntime.toggleState = null;
}
