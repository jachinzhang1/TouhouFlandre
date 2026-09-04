import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "u"],
  attributes: {
    ...defaultSchema.attributes,
    u: [],
    img: [...(defaultSchema.attributes?.img ?? []), "src", "alt", "title"],
  },
};

export function AnnouncementMarkdown({ body }: { body: string }) {
  return (
    <div className="announcement-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
        components={{
          a: ({ href, children }) => {
            const safeHref = resolveMarkdownHref(href);
            if (!safeHref) return <span>{children}</span>;
            const external = /^https?:\/\//i.test(safeHref);
            return (
              <a
                href={safeHref}
                rel={external ? "noreferrer" : undefined}
                target={external ? "_blank" : undefined}
              >
                {children}
              </a>
            );
          },
          img: ({ src, alt, title }) => {
            const safeSrc = resolveMarkdownImageSrc(src);
            if (!safeSrc) return null;
            return (
              <img
                src={safeSrc}
                alt={alt ?? ""}
                title={typeof title === "string" ? title : undefined}
                loading="lazy"
              />
            );
          },
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

function resolveMarkdownHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  const trimmed = href.trim();
  if (!trimmed || /^javascript:/i.test(trimmed)) return null;
  if (/^(https?:|mailto:|#|\/)/i.test(trimmed)) return trimmed;
  return null;
}

function resolveMarkdownImageSrc(src: unknown): string | null {
  if (typeof src !== "string") return null;
  const trimmed = src.trim().replace(/\\/g, "/");
  if (!trimmed || /^javascript:/i.test(trimmed)) return null;

  const assetMatch = trimmed.match(/^\.?\/?assets\/(.+)$/);
  if (assetMatch?.[1]) {
    const segments = assetMatch[1]
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment));
    if (!segments.length || segments.some((segment) => segment === "..")) {
      return null;
    }
    return `/api/announcements/assets/${segments.join("/")}`;
  }

  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("/")) return trimmed;
  return null;
}
