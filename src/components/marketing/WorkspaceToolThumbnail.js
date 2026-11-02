import styles from "./WorkspaceToolThumbnail.module.css";

export default function WorkspaceToolThumbnail({ tool, className = "" }) {
  return (
    <div
      className={`${styles.thumbnail} ${className}`}
      data-tool-thumbnail={tool}
      aria-hidden="true"
    />
  );
}
