/**
 * Tutorial Template Component
 * Reusable template for platform-specific tutorials
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Lightbox } from '@/components/docs/Lightbox';
import './tutorials.scss';

export interface TutorialStep {
  title: string;
  content: string;
  screenshot?: string;
  tip?: string;
}

export interface FAQItem {
  question: string;
  answer: string;
}

export interface TutorialData {
  pageTitle: string;
  backLink: string;
  backLinkUrl: string;
  overview: {
    title: string;
    content: string;
  };
  steps: TutorialStep[];
  tips: {
    title: string;
    items: string[];
  };
  faq: {
    title: string;
    items: FAQItem[];
  };
  troubleshooting: {
    title: string;
    content: string;
  };
}

interface TutorialTemplateProps {
  data: TutorialData;
  screenshotBasePath: string;
}

export function TutorialTemplate({ data, screenshotBasePath }: TutorialTemplateProps) {
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);

  const openLightbox = (src: string, alt: string) => {
    setLightboxImage({ src, alt });
  };

  const closeLightbox = () => {
    setLightboxImage(null);
  };

  return (
    <div className="docs-content tutorial-page">
      <Link to={data.backLinkUrl} className="tutorial-page__back-link">
        <ArrowLeft size={16} />
        {data.backLink}
      </Link>

      <h1>{data.pageTitle}</h1>

      {/* Overview */}
      <section className="tutorial-page__section">
        <h2>{data.overview.title}</h2>
        <p>{data.overview.content}</p>
      </section>

      {/* Steps */}
      <section className="tutorial-page__section">
        {data.steps.map((step, index) => (
          <div key={index} className="tutorial-page__step">
            <h3>
              <span className="tutorial-page__step-number">{index + 1}</span>
              {step.title}
            </h3>
            <p dangerouslySetInnerHTML={{ __html: step.content }} />

            {step.screenshot && (
              <img
                src={`${screenshotBasePath}/${step.screenshot}`}
                alt={step.title}
                className="tutorial-page__screenshot"
                onClick={() => openLightbox(`${screenshotBasePath}/${step.screenshot}`, step.title)}
              />
            )}

            {step.tip && (
              <div className="tutorial-page__tip">
                <h4>Tip</h4>
                <p>{step.tip}</p>
              </div>
            )}
          </div>
        ))}
      </section>

      {/* Tips for Best Results */}
      <section className="tutorial-page__section">
        <div className="tutorial-page__tip">
          <h4>{data.tips.title}</h4>
          <ul>
            {data.tips.items.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* FAQ */}
      <section className="tutorial-page__section tutorial-page__faq">
        <h2>{data.faq.title}</h2>
        {data.faq.items.map((item, index) => (
          <div key={index} className="tutorial-page__faq-item">
            <h4>{item.question}</h4>
            <p>{item.answer}</p>
          </div>
        ))}
      </section>

      {/* Troubleshooting */}
      <section className="tutorial-page__section">
        <h2>{data.troubleshooting.title}</h2>
        <p dangerouslySetInnerHTML={{ __html: data.troubleshooting.content }} />
      </section>

      {/* Lightbox */}
      {lightboxImage && (
        <Lightbox
          src={lightboxImage.src}
          alt={lightboxImage.alt}
          isOpen={!!lightboxImage}
          onClose={closeLightbox}
        />
      )}
    </div>
  );
}
