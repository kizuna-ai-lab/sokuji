// src/components/TitleBar/TitleBar.tsx — content header (MeetMind-style)
import { Minus, Square, X } from "lucide-react";
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { isElectron, isMacOS } from "../../utils/environment";
import SubtitleEnterButton from "../Subtitle/SubtitleEnterButton";
import type { ShellView } from "../MainLayout/NavRail";
import "./TitleBar.scss";

interface TitleBarProps {
  activeView?: ShellView;
  logsOpen?: boolean;
}

const TitleBar: React.FC<TitleBarProps> = ({
  activeView = "session",
  logsOpen = false,
}) => {
  const { t } = useTranslation();

  const minimize = useCallback(() => {
    void window.electron?.invoke("window:minimize");
  }, []);
  const maximizeToggle = useCallback(() => {
    void window.electron?.invoke("window:maximize-toggle");
  }, []);
  const close = useCallback(() => {
    void window.electron?.invoke("window:close");
  }, []);

  const pageTitle =
    activeView === "settings"
      ? t("settings.title", "Settings")
      : t("nav.session", "Session");
  const statusLine = logsOpen
    ? t("nav.logsOpen", "Logs open")
    : t("nav.appSubtitle", "Live speech translation");

  const minimizeLabel = t("titleBar.minimize", "Minimize");
  const maximizeLabel = t("titleBar.maximize", "Maximize");
  const closeLabel = t("titleBar.close", "Close");

  const showInAppWindowControls = isElectron() && !isMacOS();
  const platformClass = isElectron() && isMacOS() ? "platform-darwin" : "platform-other";

  return (
    <div
      className={`title-bar ${platformClass}${showInAppWindowControls ? " has-window-controls" : ""}`}
      role="banner">
      <div className="title-bar__page">
        <p className="title-bar__page-title">{pageTitle}</p>
        <p className="title-bar__page-meta">{statusLine}</p>
      </div>
      <div className="title-bar__actions">
        <SubtitleEnterButton />
      </div>
      {showInAppWindowControls && (
        <div className="title-bar__buttons">
          <button
            type="button"
            className="title-bar__btn title-bar__minimize"
            aria-label={minimizeLabel}
            title={minimizeLabel}
            onClick={minimize}
            onDoubleClick={(e) => e.stopPropagation()}>
            <Minus size={16} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className="title-bar__btn title-bar__maximize"
            aria-label={maximizeLabel}
            title={maximizeLabel}
            onClick={maximizeToggle}
            onDoubleClick={(e) => e.stopPropagation()}>
            <Square size={13} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className="title-bar__btn title-bar__close"
            aria-label={closeLabel}
            title={closeLabel}
            onClick={close}
            onDoubleClick={(e) => e.stopPropagation()}>
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>
      )}
    </div>
  );
};

export default TitleBar;
