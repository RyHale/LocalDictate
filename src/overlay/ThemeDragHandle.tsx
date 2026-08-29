import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

import "./ThemeDragHandle.css";

const dragWindow = getCurrentWindow();

export default function ThemeDragHandle() {
  useEffect(() => {
    let disposed = false;
    let disposeListener: (() => void) | undefined;

    void dragWindow
      .onMoved((event) => {
        void emit("theme-overlay-dragged", event.payload);
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else disposeListener = unlisten;
      });

    return () => {
      disposed = true;
      disposeListener?.();
    };
  }, []);

  const startDragging = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    void dragWindow.startDragging();
  };

  return (
    <div
      aria-hidden="true"
      className="theme-drag-handle"
      onMouseDown={startDragging}
    >
      <svg viewBox="0 0 28 8">
        <circle cx="6" cy="4" r="1.5" />
        <circle cx="14" cy="4" r="1.5" />
        <circle cx="22" cy="4" r="1.5" />
      </svg>
    </div>
  );
}
