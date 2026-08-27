import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Icon from "@mui/material/Icon";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ChatMessage } from "../hooks/useChatMessages";

/**
 * One message in the conversation: the user's own words on the right, the
 * advisor's answer on the left.
 *
 * The asymmetry is not only cosmetic. **User input is never rendered as
 * Markdown** — it is displayed as plain, pre-wrapped text, so nothing a user
 * types can style, link or otherwise dress itself up as advisor output. The
 * advisor's body goes through the pinned `react-markdown` configuration (GFM
 * tables, raw HTML **off** — never add `rehype-raw`), with links opening in a
 * new tab instead of navigating the SPA.
 *
 * It is a presentational component: it receives an already-fetched message and
 * translates only its own chrome. The send state arrives as a separate prop
 * because "seen" is a property of the *turn*, not of the message row (ui-spec
 * §3.3 derives it in the route from `activeOperationId`), while `sending` and
 * `failed` ride along on the optimistic entry itself.
 */

/** Links inside advisor Markdown never navigate the application. */
function ExternalLink({ href, children }: { href?: string; children?: ReactNode }) {
  return (
    <Link href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </Link>
  );
}

const MARKDOWN_COMPONENTS = { a: ExternalLink };
const REMARK_PLUGINS = [remarkGfm];

/**
 * Typography for the rendered answer: GFM tables carry no borders of their own,
 * a wide table must scroll rather than push the bubble, and the first and last
 * block must not add margin inside the bubble's own padding. Palette tokens only.
 */
const MARKDOWN_SX = {
  "& > :first-of-type": { mt: 0 },
  "& > :last-child": { mb: 0 },
  "& table": { borderCollapse: "collapse", my: 2 },
  "& th, & td": {
    border: 1,
    borderColor: "divider",
    px: 1,
    py: 0.5,
    textAlign: "left",
  },
  "& pre": { overflowX: "auto" },
  "& a": { wordBreak: "break-word" },
  "& p": { my: 1 },
} as const;

/**
 * Today's messages show the time, older ones the date as well — a conversation
 * is read as a sequence of turns, and a full date on every bubble is noise until
 * the turn is from another day.
 */
function formatTimestamp(createdAt: string, language: string): string {
  const timestamp = new Date(createdAt);
  const isToday = timestamp.toDateString() === new Date().toDateString();

  return isToday
    ? timestamp.toLocaleTimeString(language, { timeStyle: "short" })
    : timestamp.toLocaleString(language, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

export function MessageBubble({
  message,
  state,
  onRetry,
  onDiscard,
}: {
  message: ChatMessage;
  /**
   * Effective send state of a user message, resolved by the route: the
   * optimistic entry's own `state`, or `sent` on the newest user message while
   * the advisor's turn is in flight (that is the "Seen" signal).
   */
  state?: ChatMessage["state"];
  /** Re-fires the send with the same body; only for a failed message. */
  onRetry?: () => void;
  /** Drops the optimistic entry; only for a failed message. */
  onDiscard?: () => void;
}) {
  const { t, i18n } = useTranslation();

  const isUser = message.role === "user";
  const hasFailed = isUser && state === "failed";

  const paperSx = hasFailed
    ? {
        bgcolor: "transparent",
        border: 1,
        borderColor: "error.main",
        color: "text.primary",
        px: 2,
        py: 1.25,
        borderRadius: 3,
      }
    : {
        bgcolor: "primary.main",
        color: "primary.contrastText",
        px: 2,
        py: 1.25,
        borderRadius: 3,
      };

  function renderCaption() {
    if (isUser && state === "sending") {
      return (
        <>
          <CircularProgress size={12} color="inherit" />
          <Typography variant="caption">{t("consultations.chat.sending")}</Typography>
        </>
      );
    }

    if (isUser && state === "sent") {
      return (
        <>
          <Icon fontSize="inherit">check</Icon>
          <Typography variant="caption">{t("consultations.chat.seen")}</Typography>
        </>
      );
    }

    if (hasFailed) {
      // Colour is never the only signal: the error border is paired with the
      // words "Not sent." and with the two ways out of it.
      return (
        <>
          <Icon fontSize="inherit">error</Icon>
          <Typography variant="caption">{t("consultations.chat.sendFailed")}</Typography>
          {onRetry !== undefined && (
            <Button size="small" color="inherit" onClick={onRetry}>
              {t("consultations.chat.sendRetry")}
            </Button>
          )}
          {onDiscard !== undefined && (
            <Button size="small" color="inherit" onClick={onDiscard}>
              {t("consultations.chat.sendDiscard")}
            </Button>
          )}
        </>
      );
    }

    return (
      <Typography variant="caption">
        {formatTimestamp(message.createdAt, i18n.language)}
      </Typography>
    );
  }

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignSelf: isUser ? "flex-end" : "flex-start",
        alignItems: isUser ? "flex-end" : "flex-start",
        maxWidth: isUser ? { xs: "85%", sm: 560 } : { xs: "95%", sm: 720 },
      }}
    >
      {isUser ? (
        <Paper elevation={0} sx={paperSx}>
          <Typography
            variant="body1"
            sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
          >
            {message.body}
          </Typography>
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ px: 2, py: 1.25, borderRadius: 3 }}>
          {/* Part slot 1 — tool-call blocks (ui-spec §8), added in step 3.10. */}
          <Box sx={MARKDOWN_SX}>
            <Markdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
              {message.body}
            </Markdown>
          </Box>
          {/* Part slot 2 — recommendation cards (ui-spec §9), step 3.10. */}
          {/* Part slot 3 — the sources toggle (ui-spec §7), step 3.10. */}
        </Paper>
      )}
      <Stack
        direction="row"
        spacing={0.5}
        sx={{
          alignItems: "center",
          mt: 0.25,
          color: hasFailed ? "error.main" : "text.secondary",
        }}
      >
        {renderCaption()}
      </Stack>
    </Box>
  );
}
