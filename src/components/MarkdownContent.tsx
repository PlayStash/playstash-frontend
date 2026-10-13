import clsx from "clsx";
import Markdown, { Components } from "react-markdown";

type MarkdownContentProps = {
  content: string;
  className?: string;
};

// External links are routed through the global opener in Tauri; in browsers
// target="_blank" opens a new tab as usual.
const markdownComponents: Components = {
  a: ({ href, children, ...props }) => (
    <a {...props} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

export default function MarkdownContent({
  content,
  className,
}: MarkdownContentProps) {
  const normalizedContent = content
    .replace(/\r\n/g, "\n")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n");

  return (
    <div
      className={clsx(
        "prose prose-sm max-w-none text-ps-text",
        "prose-headings:font-semibold prose-headings:text-ps-text",
        "prose-p:leading-7 prose-p:text-ps-text",
        "prose-a:text-ps-accent prose-a:no-underline hover:prose-a:text-ps-accent-strong",
        "prose-strong:text-ps-text",
        "prose-code:rounded prose-code:bg-ps-panel-soft prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.9em] prose-code:text-ps-text",
        "prose-pre:rounded-xl prose-pre:border prose-pre:border-ps-line prose-pre:bg-ps-panel-strong prose-pre:shadow-sm",
        "prose-blockquote:border-l-ps-line prose-blockquote:text-ps-muted",
        "prose-li:text-ps-text prose-li:marker:text-ps-muted",
        className,
      )}
    >
      <Markdown components={markdownComponents}>{normalizedContent}</Markdown>
    </div>
  );
}