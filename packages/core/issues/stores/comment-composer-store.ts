import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultStorage } from "../../platform/storage";

/** Personal preference for keeping the comment bar reachable in long timelines. */
interface CommentComposerStore {
  sticky: boolean;
  toggleSticky: () => void;
}

export const useCommentComposerStore = create<CommentComposerStore>()(
  persist(
    (set) => ({
      sticky: true,
      toggleSticky: () => set((s) => ({ sticky: !s.sticky })),
    }),
    {
      name: "multica_comment_composer",
      storage: createJSONStorage(() => defaultStorage),
    },
  ),
);
