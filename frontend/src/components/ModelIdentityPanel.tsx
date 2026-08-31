import { zodResolver } from "@hookform/resolvers/zod";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Grid from "@mui/material/Grid";
import Icon from "@mui/material/Icon";
import Skeleton from "@mui/material/Skeleton";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { TFunction } from "i18next";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { useBuildinglines } from "../hooks/useBuildinglines";
import { useManufacturers, type Manufacturer } from "../hooks/useCatalogueModels";
import type { Operation } from "../hooks/useOperations";
import {
  SaveIdentityError,
  useSaveIdentity,
  type ProductWithIdentity,
} from "../hooks/useProductReview";

import {
  collapseClaimedYears,
  formatClaimedTypeCodes,
  formatClaimedYears,
  matchManufacturerClaim,
  unionTypeCodes,
} from "./claimLogic";
import { ClaimFieldRow, ModelClaimPanel } from "./ModelClaimPanel";

/**
 * The Identity tab (roadmap 6.1/6.3, ui-spec §1 + §2, display-spec §6.2): the
 * manufacturer/buildingline/model-name/year-range/type-codes form, the
 * unverified claim above it, and the live level-1/level-2 preview.
 *
 * Mirrors `ModelSpecsPanel`'s shape (React Hook Form + Zod, submit-only
 * validation, explicit save, dirty state reported upward) and, like it, edits
 * a full-object-replace block: the identity PATCH always carries every
 * identity field, and (until step 6.25 builds the trims editor) the last
 * fetched `variants` list unchanged — see `useSaveIdentity`.
 */

// Duplicated from `backend/app/services/ingestion/service.py:76` — a fragile
// string contract (ui-spec §2.4 / API-7, shared-knowledge D13, OQ-2). A
// backend rename of this prefix must update both locations.
const WARNING_SUMMARY_PREFIX = "Completed with warnings: ";

const TYPE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9\-/ ]{1,31}$/;
const TYPE_CODES_CAP = 8;
const CURRENT_YEAR = new Date().getFullYear();

/** Trimmed on entry, empty string becomes `null` — the shared string rule of §1.3. */
function trimmedNullable(maxLength: number, errorMessage: string) {
  return z
    .string()
    .transform((raw) => raw.trim())
    .transform((raw) => (raw === "" ? null : raw))
    .refine((value) => value === null || value.length <= maxLength, {
      message: errorMessage,
    });
}

/** Empty → `null`; else a plausible four-digit year (§1.3). */
const yearInput = z
  .string()
  .transform((raw) => raw.trim())
  .transform((raw) => (raw === "" ? null : raw))
  .transform((raw, ctx) => {
    if (raw === null) {
      return null;
    }

    const year = Number(raw);

    if (!/^\d{4}$/.test(raw) || year < 1885 || year > CURRENT_YEAR + 2) {
      ctx.addIssue({ code: "custom", message: "admin.identity.errors.yearInvalid" });
      return z.NEVER;
    }

    return year;
  });

const identityFormSchema = z
  .object({
    // Curated by the manufacturer Autocomplete; nothing to validate beyond
    // "one of the loaded options or unselected" (the picker cannot invent one).
    manufacturer: z.custom<Manufacturer | null>(() => true),
    buildingline: trimmedNullable(64, "admin.identity.errors.buildinglineTooLong"),
    modelName: trimmedNullable(128, "admin.identity.errors.modelNameTooLong"),
    yearFrom: yearInput,
    yearTo: yearInput,
    // A safety net: entry-time handling (below) already refuses a bad-shape or
    // over-cap code before it becomes a chip, so these two checks should never
    // actually fire — kept because §1.3 pins them as part of the contract.
    typeCodes: z
      .array(z.string())
      .max(TYPE_CODES_CAP, { message: "admin.identity.errors.typeCodesMax" })
      .refine((codes) => codes.every((code) => TYPE_CODE_PATTERN.test(code)), {
        message: "admin.identity.errors.typeCodeInvalid",
      }),
  })
  .superRefine((values, ctx) => {
    if (
      values.yearFrom !== null &&
      values.yearTo !== null &&
      values.yearTo < values.yearFrom
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["yearTo"],
        message: "admin.identity.errors.yearOrder",
      });
    }
  });

type IdentityFormInput = z.input<typeof identityFormSchema>;
type IdentityFormValues = z.output<typeof identityFormSchema>;

/** The form's own fields with an inline validation/server error (`manufacturer` is not one). */
type ValidatedField = "buildingline" | "modelName" | "yearFrom" | "yearTo" | "typeCodes";

/**
 * Every §1.3 message a field can show, translated through a literal key at
 * every call site — the project's typed i18n key union (`pnpm typecheck`)
 * rejects a `t()` call whose key is a plain `string`, so a zod message or a
 * `ValidatedField` name is translated through an exhaustive `switch` instead
 * of an indexed lookup, never widened or cast.
 */
function translateIdentityErrorKey(t: TFunction, key: string): string {
  switch (key) {
    case "admin.identity.errors.modelNameTooLong":
      return t("admin.identity.errors.modelNameTooLong");
    case "admin.identity.errors.buildinglineTooLong":
      return t("admin.identity.errors.buildinglineTooLong");
    case "admin.identity.errors.yearInvalid":
      return t("admin.identity.errors.yearInvalid");
    case "admin.identity.errors.yearOrder":
      return t("admin.identity.errors.yearOrder");
    case "admin.identity.errors.typeCodeInvalid":
      return t("admin.identity.errors.typeCodeInvalid");
    case "admin.identity.errors.typeCodesMax":
      return t("admin.identity.errors.typeCodesMax");
    default:
      // Unreachable in practice — every message this form sets is one of the
      // six keys above — but a `t()` call still needs a literal key.
      return t("common.errors.serverError");
  }
}

/**
 * A server-mapped 422 (`form.setError(field, { type: "server" })`, ui-spec
 * §1.5) carries no message of its own — the field's §1.3 message is shown
 * regardless of which specific rule the server enforced, same as a
 * client-side failure on that field.
 */
function defaultFieldErrorMessage(t: TFunction, name: ValidatedField): string {
  switch (name) {
    case "buildingline":
      return t("admin.identity.errors.buildinglineTooLong");
    case "modelName":
      return t("admin.identity.errors.modelNameTooLong");
    case "yearFrom":
    case "yearTo":
      return t("admin.identity.errors.yearInvalid");
    case "typeCodes":
      return t("admin.identity.errors.typeCodeInvalid");
  }
}

/** The identity PATCH block's attribute names → this form's field names. */
const SERVER_FIELD_TO_FORM: Record<string, keyof IdentityFormInput> = {
  manufacturerId: "manufacturer",
  buildingline: "buildingline",
  modelName: "modelName",
  yearFrom: "yearFrom",
  yearTo: "yearTo",
  typeCodes: "typeCodes",
};

function numberToInput(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

function toFormValues(product: ProductWithIdentity): IdentityFormInput {
  return {
    // Resolved once the manufacturer options load (see the effect below): the
    // API does not (yet) answer with a manufacturer id, only its rendered name.
    manufacturer: null,
    buildingline: product.buildingline ?? "",
    modelName: product.modelName ?? "",
    yearFrom: numberToInput(product.yearFrom),
    yearTo: numberToInput(product.yearTo),
    typeCodes: product.typeCodes ?? [],
  };
}

/** One claimed year span, formatted like the CLI summary (`2019–2023`, `from 2019`). */
function formatYearRange(t: TFunction, yearFrom: number | null, yearTo: number | null): string | null {
  if (yearFrom === null && yearTo === null) {
    return null;
  }
  if (yearFrom !== null && yearTo !== null) {
    return yearFrom === yearTo
      ? t("common.modelName.yearSingle", { year: yearFrom })
      : t("common.modelName.yearRange", { from: yearFrom, to: yearTo });
  }
  return yearFrom !== null
    ? t("common.modelName.yearFrom", { from: yearFrom })
    : t("common.modelName.yearUntil", { to: yearTo });
}

/**
 * Panel-local preview of the **unsaved form buffer** — the one exception to
 * "the frontend never formats a name" (D5, adjudicated 2026-08-31: previewing
 * a value that has no server counterpart is not rendering a persisted name).
 * Not exported, not shared with any other module, and never applied to a
 * value that came back from the API — once a name is saved, the displayed
 * name is the server's rendered `name`.
 */
function previewLevels(
  t: TFunction,
  manufacturerName: string | null,
  modelNameInput: string,
  queryName: string,
  yearFrom: number | null,
  yearTo: number | null,
): { level1: string; level2: string } {
  const trimmedModel = modelNameInput.trim();
  // §11 fallback: never an empty parenthesis, never a blank name — the
  // originally-entered query name carries the preview until research fills in
  // a real model name.
  const model = trimmedModel !== "" ? trimmedModel : queryName;
  const level1 =
    manufacturerName !== null && manufacturerName !== "" ? `${manufacturerName} ${model}` : model;
  const yearRange = formatYearRange(t, yearFrom, yearTo);
  const level2 = yearRange === null ? level1 : `${level1} (${yearRange})`;

  return { level1, level2 };
}

/** The `admin.identity.slug` / `admin.identity.queryName` read-only context rows (§1.1). */
function ContextRows({ slug, queryName }: { slug: string; queryName: string }) {
  const { t } = useTranslation();

  return (
    <Box sx={{ mt: 2 }}>
      <Table size="small">
        <TableBody>
          <TableRow>
            <TableCell component="th" scope="row" sx={{ width: "30%" }}>
              {t("admin.identity.slug")}
            </TableCell>
            <TableCell sx={{ fontFamily: "monospace" }}>{slug}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell component="th" scope="row">
              {t("admin.identity.queryName")}
            </TableCell>
            <TableCell color="text.secondary">&quot;{queryName}&quot;</TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <Typography variant="caption" color="text.secondary">
        {t("admin.identity.slugHint")}
      </Typography>
    </Box>
  );
}

/** The read-only rendering for an approved model (§1.7) — values, never a form. */
function ReadOnlyIdentity({ product }: { product: ProductWithIdentity }) {
  const { t } = useTranslation();
  const yearRange = formatYearRange(t, product.yearFrom, product.yearTo);
  const rows: [string, string][] = [
    [t("admin.identity.manufacturer"), product.manufacturer ?? t("common.unknown")],
    [t("admin.identity.buildingline"), product.buildingline ?? t("common.unknown")],
    [t("admin.identity.modelName"), product.modelName ?? t("common.unknown")],
    [t("admin.identity.yearFrom"), yearRange ?? t("common.unknown")],
  ];

  return (
    <Box sx={{ maxWidth: 720 }}>
      {product.suggestion != null && (
        <Box sx={{ mb: 2 }}>
          <ModelClaimPanel suggestion={product.suggestion} collapsed />
        </Box>
      )}
      <Table size="small">
        <TableBody>
          {rows.map(([label, value]) => (
            <TableRow key={label}>
              <TableCell component="th" scope="row" sx={{ width: "40%" }}>
                {label}
              </TableCell>
              <TableCell>{value}</TableCell>
            </TableRow>
          ))}
          {(product.typeCodes ?? []).length > 0 && (
            <TableRow>
              <TableCell component="th" scope="row">
                {t("admin.identity.typeCodes")}
              </TableCell>
              <TableCell>
                <Stack direction="row" spacing={0.5} flexWrap="wrap">
                  {(product.typeCodes ?? []).map((code) => (
                    <Chip
                      key={code}
                      size="small"
                      variant="outlined"
                      sx={{ fontFamily: "monospace" }}
                      label={code}
                      aria-label={t("admin.identity.typeCodeA11y", { code })}
                    />
                  ))}
                </Stack>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <ContextRows slug={product.slug} queryName={product.queryName ?? product.name} />
    </Box>
  );
}

export function ModelIdentityPanel({
  product,
  operation,
  onDirtyChange,
}: {
  product: ProductWithIdentity;
  /** The row's latest operation, so a succeeded-with-warnings run can be flagged (§2.4). */
  operation?: Operation;
  /**
   * Reports whether the form holds unsaved edits, so the approve dialog can warn
   * that approval publishes the last **saved** identity.
   */
  onDirtyChange: (isDirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const save = useSaveIdentity(product.id);
  const manufacturers = useManufacturers();

  const [isSaved, setIsSaved] = useState(false);
  const [hasGeneralError, setHasGeneralError] = useState(false);
  const [hasDuplicateError, setHasDuplicateError] = useState(false);
  const [typeCodeInput, setTypeCodeInput] = useState("");
  const [typeCodeError, setTypeCodeError] = useState<string | null>(null);

  const form = useForm<IdentityFormInput, unknown, IdentityFormValues>({
    resolver: zodResolver(identityFormSchema),
    defaultValues: toFormValues(product),
    // Phase-1 convention: no keystroke validation anywhere.
    mode: "onSubmit",
  });

  const { errors, isDirty } = form.formState;
  const isPending = save.isPending;
  // Watches exactly the fields the live preview and the buildingline lookup
  // need — called unconditionally, above the approved-row early return below.
  // Narrower than the whole form buffer on purpose: typing a type code or a
  // buildingline must not re-render this whole panel on every keystroke, only
  // the fields the preview actually composes need to.
  const [watchedManufacturer, watchedModelName, watchedYearFrom, watchedYearTo] = useWatch({
    control: form.control,
    name: ["manufacturer", "modelName", "yearFrom", "yearTo"],
  });
  const manufacturerId = watchedManufacturer?.id ?? null;
  const buildinglines = useBuildinglines(manufacturerId);

  // The dirty flag belongs to the page (the approve dialog needs it); the
  // cleanup covers unmounting too, so there is nothing left to warn about once
  // the form buffer is gone.
  useEffect(() => {
    onDirtyChange(isDirty);

    return () => {
      onDirtyChange(false);
    };
  }, [isDirty, onDirtyChange]);

  // The API does not (yet) answer with a manufacturer id, only the rendered
  // name (`product.manufacturer`) — so the initial selection is resolved by a
  // case-insensitive match against the loaded options, exactly like the claim
  // panel's own manufacturer matching. Runs once per mount; a later user edit
  // must never be clobbered by a refetch.
  const manufacturerInitialized = useRef(false);

  useEffect(() => {
    if (manufacturerInitialized.current || manufacturers.data === undefined) {
      return;
    }
    if (product.manufacturer !== null && product.manufacturer !== undefined) {
      const match = manufacturers.data.find(
        (option) => option.name.toLowerCase() === product.manufacturer?.toLowerCase(),
      );

      if (match !== undefined) {
        form.setValue("manufacturer", match);
      }
    }
    manufacturerInitialized.current = true;
  }, [manufacturers.data, product.manufacturer, form]);

  if (product.status === "approved") {
    return <ReadOnlyIdentity product={product} />;
  }

  const suggestion = product.suggestion ?? null;
  const manufacturerClaimMatch =
    suggestion !== null ? matchManufacturerClaim(suggestion, manufacturers.data ?? []) : null;
  const claimedYears = suggestion !== null ? formatClaimedYears(t, suggestion) : null;
  const collapsedYears = suggestion !== null ? collapseClaimedYears(suggestion) : null;

  const optionsError = manufacturers.isError || (manufacturerId !== null && buildinglines.isError);

  function retryOptions() {
    void manufacturers.refetch();
    if (manufacturerId !== null) {
      void buildinglines.refetch();
    }
  }

  const showResearchWarning =
    operation?.status === "succeeded" &&
    operation.message !== null &&
    operation.message !== undefined &&
    operation.message.startsWith(WARNING_SUMMARY_PREFIX);
  const warningBody = showResearchWarning
    ? (operation?.message ?? "").slice(WARNING_SUMMARY_PREFIX.length)
    : "";

  const preview = previewLevels(
    t,
    watchedManufacturer?.name ?? null,
    watchedModelName ?? "",
    product.queryName ?? product.name,
    watchedYearFrom === "" || watchedYearFrom === undefined ? null : Number(watchedYearFrom),
    watchedYearTo === "" || watchedYearTo === undefined ? null : Number(watchedYearTo),
  );

  function fieldError(name: ValidatedField): boolean {
    return errors[name] !== undefined;
  }

  function fieldErrorMessage(name: ValidatedField): string | undefined {
    if (errors[name] === undefined) {
      return undefined;
    }

    const message = errors[name]?.message;

    return typeof message === "string" && message !== ""
      ? translateIdentityErrorKey(t, message)
      : defaultFieldErrorMessage(t, name);
  }

  function handleTypeCodesChange(newValue: string[]) {
    // MUI reports the whole next array; a shrink is always a chip removal and
    // is always allowed.
    if (newValue.length <= form.getValues("typeCodes").length) {
      form.setValue("typeCodes", newValue, { shouldDirty: true });
      setTypeCodeError(null);
      return;
    }

    const current = form.getValues("typeCodes");
    const candidate = newValue[newValue.length - 1] ?? "";
    const normalized = candidate.trim().toUpperCase();

    if (current.length >= TYPE_CODES_CAP) {
      setTypeCodeError("admin.identity.errors.typeCodesMax");
      return;
    }
    if (!TYPE_CODE_PATTERN.test(normalized)) {
      setTypeCodeError("admin.identity.errors.typeCodeInvalid");
      return;
    }

    setTypeCodeInput("");
    setTypeCodeError(null);
    // Duplicates are dropped silently rather than added twice.
    if (!current.includes(normalized)) {
      form.setValue("typeCodes", [...current, normalized], { shouldDirty: true });
    }
  }

  const submit = form.handleSubmit((formValues) => {
    setHasGeneralError(false);
    setHasDuplicateError(false);

    save.mutate(
      {
        values: {
          manufacturerId: formValues.manufacturer?.id ?? null,
          buildingline: formValues.buildingline,
          modelName: formValues.modelName,
          yearFrom: formValues.yearFrom,
          yearTo: formValues.yearTo,
          typeCodes: formValues.typeCodes,
        },
      },
      {
        onSuccess: () => {
          // Reset to what was just sent: the form is no longer dirty, and the
          // refetched row carries the same values plus the recomputed slug.
          form.reset(form.getValues());
          setIsSaved(true);
        },
        onError: (error) => {
          if (!(error instanceof SaveIdentityError)) {
            setHasGeneralError(true);
            return;
          }

          if (error.status === 409 || error.code === "duplicate-model") {
            setHasDuplicateError(true);
            return;
          }

          const mappable = error.validationFields
            .map((field) => SERVER_FIELD_TO_FORM[field])
            .filter((field): field is keyof IdentityFormInput => field !== undefined);

          for (const field of mappable) {
            form.setError(field, { type: "server" });
          }

          if (mappable.length === 0) {
            setHasGeneralError(true);
          }
        },
      },
    );
  });

  return (
    <Box component="form" noValidate onSubmit={submit} sx={{ maxWidth: 900 }}>
      {suggestion !== null && <ModelClaimPanel suggestion={suggestion} />}
      {showResearchWarning && (
        <Alert severity="warning" icon={<Icon>report</Icon>} sx={{ mb: 2 }}>
          <Typography variant="subtitle2">{t("admin.identity.researchWarnings")}</Typography>
          <Typography variant="body2">{warningBody}</Typography>
        </Alert>
      )}
      {optionsError && (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={
            <Button size="small" onClick={retryOptions}>
              {t("common.retry")}
            </Button>
          }
        >
          {t("admin.identity.optionsLoadError")}
        </Alert>
      )}
      {hasDuplicateError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t("admin.identity.errors.duplicateIdentity")}
        </Alert>
      )}
      {hasGeneralError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t("common.errors.serverError")}
        </Alert>
      )}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6 }}>
          {manufacturers.isPending ? (
            <Skeleton variant="rounded" height={56} />
          ) : (
            <Controller
              name="manufacturer"
              control={form.control}
              render={({ field }) => (
                <Autocomplete
                  options={manufacturers.data ?? []}
                  getOptionLabel={(option) => option.name}
                  isOptionEqualToValue={(option, value) => option.id === value.id}
                  value={field.value}
                  disabled={isPending}
                  onChange={(_event, newValue) => field.onChange(newValue)}
                  renderInput={(params) => (
                    <TextField {...params} label={t("admin.identity.manufacturer")} />
                  )}
                />
              )}
            />
          )}
          {suggestion?.manufacturer != null && (
            <ClaimFieldRow
              value={suggestion.manufacturer}
              useLabel={t("admin.identity.claim.use")}
              useA11yLabel={t("admin.identity.claim.useA11y", {
                field: t("admin.identity.manufacturer"),
              })}
              disabled={isPending}
              onUse={
                manufacturerClaimMatch !== null
                  ? () => form.setValue("manufacturer", manufacturerClaimMatch, { shouldDirty: true })
                  : undefined
              }
              noMatchCaption={
                manufacturerClaimMatch === null
                  ? t("admin.identity.claim.noManufacturerMatch")
                  : undefined
              }
            />
          )}
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          {manufacturerId === null ? (
            <TextField
              fullWidth
              disabled
              label={t("admin.identity.buildingline")}
              helperText={t("admin.identity.buildinglineNeedsManufacturer")}
            />
          ) : buildinglines.isPending ? (
            <Skeleton variant="rounded" height={56} />
          ) : (
            <Controller
              name="buildingline"
              control={form.control}
              render={({ field }) => (
                <Autocomplete
                  freeSolo
                  options={buildinglines.data ?? []}
                  disabled={isPending}
                  value={field.value}
                  inputValue={field.value}
                  onChange={(_event, newValue) => field.onChange(newValue ?? "")}
                  onInputChange={(_event, newInputValue, reason) => {
                    if (reason === "input") {
                      field.onChange(newInputValue);
                    }
                  }}
                  onBlur={() => {
                    const match = (buildinglines.data ?? []).find(
                      (option) => option.toLowerCase() === field.value.trim().toLowerCase(),
                    );

                    if (match !== undefined && match !== field.value) {
                      field.onChange(match);
                    }
                    field.onBlur();
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label={t("admin.identity.buildingline")}
                      error={fieldError("buildingline")}
                      helperText={fieldErrorMessage("buildingline") ?? t("admin.identity.buildinglineHint")}
                    />
                  )}
                />
              )}
            />
          )}
        </Grid>
        <Grid size={{ xs: 12 }}>
          <TextField
            {...form.register("modelName")}
            fullWidth
            disabled={isPending}
            label={t("admin.identity.modelName")}
            error={fieldError("modelName")}
            helperText={fieldErrorMessage("modelName") ?? t("admin.identity.modelNameHint")}
          />
          {suggestion?.model != null && (
            <ClaimFieldRow
              value={suggestion.model}
              useLabel={t("admin.identity.claim.use")}
              useA11yLabel={t("admin.identity.claim.useA11y", {
                field: t("admin.identity.modelName"),
              })}
              disabled={isPending}
              onUse={() =>
                form.setValue("modelName", suggestion.model ?? "", { shouldDirty: true })
              }
            />
          )}
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            {...form.register("yearFrom")}
            fullWidth
            disabled={isPending}
            label={t("admin.identity.yearFrom")}
            error={fieldError("yearFrom")}
            helperText={fieldErrorMessage("yearFrom")}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            {...form.register("yearTo")}
            fullWidth
            disabled={isPending}
            label={t("admin.identity.yearTo")}
            error={fieldError("yearTo")}
            helperText={fieldErrorMessage("yearTo") ?? t("admin.identity.yearToHint")}
          />
          {claimedYears !== null && (
            <ClaimFieldRow
              value={claimedYears}
              useLabel={t("admin.identity.claim.use")}
              useA11yLabel={t("admin.identity.claim.useA11y", {
                field: `${t("admin.identity.yearFrom")}/${t("admin.identity.yearTo")}`,
              })}
              disabled={isPending}
              onUse={
                collapsedYears !== null
                  ? () => {
                      form.setValue("yearFrom", String(collapsedYears.yearFrom), {
                        shouldDirty: true,
                      });
                      form.setValue(
                        "yearTo",
                        collapsedYears.yearTo === null ? "" : String(collapsedYears.yearTo),
                        { shouldDirty: true },
                      );
                    }
                  : undefined
              }
            />
          )}
        </Grid>
        <Grid size={{ xs: 12 }}>
          <Controller
            name="typeCodes"
            control={form.control}
            render={({ field }) => (
              <Autocomplete
                multiple
                freeSolo
                options={[]}
                disabled={isPending}
                value={field.value}
                inputValue={typeCodeInput}
                onInputChange={(_event, newInputValue, reason) => {
                  if (reason === "input") {
                    setTypeCodeInput(newInputValue);
                    setTypeCodeError(null);
                  }
                }}
                onChange={(_event, newValue) => handleTypeCodesChange(newValue as string[])}
                renderTags={(tagValue, getTagProps) =>
                  tagValue.map((code, index) => (
                    <Chip
                      {...getTagProps({ index })}
                      key={code}
                      size="small"
                      label={code}
                      sx={{ fontFamily: "monospace" }}
                      aria-label={t("admin.identity.typeCodeA11y", { code })}
                    />
                  ))
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={t("admin.identity.typeCodes")}
                    error={typeCodeError !== null || fieldError("typeCodes")}
                    helperText={
                      typeCodeError !== null
                        ? translateIdentityErrorKey(t, typeCodeError)
                        : (fieldErrorMessage("typeCodes") ?? t("admin.identity.typeCodesHint"))
                    }
                  />
                )}
              />
            )}
          />
          {suggestion !== null && suggestion.typeCodes.length > 0 && (
            <ClaimFieldRow
              value={formatClaimedTypeCodes(suggestion)}
              useLabel={t("admin.identity.claim.use")}
              useA11yLabel={t("admin.identity.claim.useA11y", {
                field: t("admin.identity.typeCodes"),
              })}
              disabled={isPending}
              onUse={() => {
                const { codes, capped } = unionTypeCodes(
                  form.getValues("typeCodes"),
                  suggestion.typeCodes,
                );

                form.setValue("typeCodes", codes, { shouldDirty: true });
                setTypeCodeError(capped ? "admin.identity.errors.typeCodesMax" : null);
              }}
            />
          )}
        </Grid>
      </Grid>

      <ContextRows slug={product.slug} queryName={product.queryName ?? product.name} />

      <Box sx={{ mt: 3 }}>
        <Typography variant="subtitle2">{t("admin.identity.preview.heading")}</Typography>
        <Typography variant="body2">
          {t("admin.identity.preview.level", { n: 1 })}: {preview.level1}
        </Typography>
        <Typography variant="body2">
          {t("admin.identity.preview.level", { n: 2 })}: {preview.level2}
        </Typography>
      </Box>

      <Stack direction="row" spacing={2} sx={{ mt: 3 }}>
        <Button
          type="submit"
          variant="contained"
          disabled={!isDirty || isPending}
          startIcon={
            isPending ? <CircularProgress size={20} color="inherit" /> : undefined
          }
        >
          {t("admin.identity.save")}
        </Button>
        <Button disabled={!isDirty || isPending} onClick={() => form.reset()}>
          {t("admin.identity.discard")}
        </Button>
      </Stack>
      <Snackbar
        open={isSaved}
        autoHideDuration={4000}
        onClose={() => setIsSaved(false)}
      >
        <Alert severity="success">{t("admin.identity.saved")}</Alert>
      </Snackbar>
    </Box>
  );
}
