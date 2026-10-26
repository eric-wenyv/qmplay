import { icon } from "../icons.js";

/** Only the repository's static SVG icon catalogue enters this HTML boundary. */
export function Icon({
  name,
  className = "icon-slot",
  id,
}: {
  name: string;
  className?: string;
  id?: string;
}) {
  return (
    <span
      id={id}
      className={className}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: icon(name) }}
    />
  );
}
