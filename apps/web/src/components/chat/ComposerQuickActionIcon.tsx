import { BookOpenIcon, MessageSquareIcon, ThumbsUpIcon, UsersRoundIcon } from "lucide-react";
import { createElement, lazy, Suspense } from "react";
import type { ComposerQuickAction } from "@t3tools/contracts/settings";
import { projectIconColorClassName } from "../../projectIconColors";
import { ProjectMonogram } from "../ProjectMonogram";

const CustomIcon = lazy(() =>
  import("../../lib/lucideIconByName").then(({ lucideIconByName }) => ({
    default: function CustomIcon({ name, className }: { name: string; className: string }) {
      return createElement(lucideIconByName(name) ?? MessageSquareIcon, {
        className,
        "aria-hidden": true,
      });
    },
  })),
);

export function ComposerQuickActionIcon({ icon }: { icon: ComposerQuickAction["icon"] }) {
  if (icon.kind === "emoji") return <span aria-hidden>{icon.emoji}</span>;
  if (icon.kind === "monogram")
    return <ProjectMonogram text={icon.text} color={icon.color} className="size-4" />;
  const className = projectIconColorClassName(icon.color);
  const BuiltIn =
    icon.name === "users-round"
      ? UsersRoundIcon
      : icon.name === "thumbs-up"
        ? ThumbsUpIcon
        : icon.name === "book-open"
          ? BookOpenIcon
          : null;
  return BuiltIn ? (
    <BuiltIn aria-hidden className={className} />
  ) : (
    <Suspense fallback={<MessageSquareIcon aria-hidden />}>
      <CustomIcon name={icon.name} className={className} />
    </Suspense>
  );
}
