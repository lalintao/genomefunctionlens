import type { MouseEvent } from "react";

import type { Language, TopPage } from "../../shared/types";
import { DESIGN_PREVIEW_TEXT } from "../../shared/designPreviewText";
import LanguageSelector from "./LanguageSelector";

export type TopMenuTarget = "query" | "examples" | "about";

interface TopMenuText {
  brandTitle: string;
  brandSubtitle: string;
  language: string;
}

interface Props {
  activePage: TopPage;
  language: Language;
  text: TopMenuText;
  onNavigate: (target: TopMenuTarget) => void;
  onLanguageChange: (language: Language) => void;
  onOpenSavedQueries: () => void;
  localMode?: boolean;
}

export default function TopMenu(props: Props) {
  const copy = DESIGN_PREVIEW_TEXT[props.language];
  const navigate = (target: TopMenuTarget) => (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    props.onNavigate(target);
  };

  return (
    <header className="dp-topbar">
      <div className="dp-topbar-brand-wrap">
        <strong className="dp-topbar-brand">{props.text.brandTitle}</strong>
        <span className="dp-topbar-brand-subtitle">{props.text.brandSubtitle}</span>
      </div>
      <nav className="dp-nav-links">
        <a aria-current={props.activePage === "home" || props.activePage === "query" ? "page" : undefined} className={props.activePage === "home" || props.activePage === "query" ? "active" : ""} href="#query" onClick={navigate("query")}>{copy.navQuery}</a>
        <a aria-current={props.activePage === "examples" ? "page" : undefined} className={props.activePage === "examples" ? "active" : ""} href="#examples" onClick={navigate("examples")}>{copy.navExamples}</a>
        <a aria-current={props.activePage === "about" ? "page" : undefined} className={props.activePage === "about" ? "active" : ""} href="#about" onClick={navigate("about")}>{copy.navAbout}</a>
        {props.localMode ? (
          <button type="button" className="dp-nav-action" onClick={props.onOpenSavedQueries}>
            {props.language === "zh" ? "我的查询记录" : "My saved queries"}
          </button>
        ) : null}
      </nav>
      <div className="dp-topbar-tools">
        <LanguageSelector language={props.language} onLanguageChange={props.onLanguageChange} label={props.text.language} />
        {props.localMode ? (
          <span className="dp-auth-trigger dp-auth-trigger-text" title={props.language === "zh" ? "本地单用户版本" : "Local single-user edition"}>
            <span>{props.language === "zh" ? "本地版" : "Local Edition"}</span>
          </span>
        ) : null}
      </div>
    </header>
  );
}
