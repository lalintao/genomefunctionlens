import type { Language } from "../shared/types";
import { Mail } from "lucide-react";

export default function AboutPage({ language }: { language: Language }) {
  const zh = language === "zh";
  return (
    <section className="dp-about-section about-lab-page">
      <div className="dp-about-rule" aria-hidden="true" />
      <div className="about-lab-intro">
        <p className="section-label">{zh ? "关于我们" : "About Us"}</p>
        <h1>{zh ? "实验室介绍" : "Laboratory"}</h1>
        <p>
          {zh
            ? "我们关注微生物基因组学、蛋白质功能注释与系统发育分布分析，致力于构建可复现、易使用的生物信息学研究工具。"
            : "Our work focuses on microbial genomics, protein functional annotation, and phylogenetic distribution analysis. We build reproducible and practical bioinformatics tools for research workflows."}
        </p>
      </div>

      <div className="dp-about-grid">
        <div className="dp-about-logos">
          <img src="/design-preview/img/team_logo.png" alt={zh ? "实验室标识" : "Laboratory logo"} />
          <img src="/design-preview/img/colleg_logo.png" alt={zh ? "学院标识" : "College logo"} />
        </div>

        <div className="dp-about-info">
          <div className="dp-about-block">
            <strong>{zh ? "反馈与协作" : "Feedback and Collaboration"}</strong>
            <span>{zh ? "欢迎通过以下渠道了解项目、提交问题或参与协作。" : "Use the links below to explore the project, report an issue, or collaborate."}</span>
          </div>
          <div className="dp-about-block">
            <span>GitHub</span>
            <a href="https://github.com/lalintao/web_sever" target="_blank" rel="noreferrer">
              github.com/lalintao/web_sever
            </a>
          </div>
          <div className="dp-about-block">
            <span>{zh ? "邮箱" : "Email"}</span>
            <a href="mailto:2510062005@mails.szu.edu.cn">
              <Mail size={15} aria-hidden="true" />
              2510062005@mails.szu.edu.cn
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
