import { UserAvatar } from "@/components/UserAvatar";
import { useAlertDialog } from "@/context/AlertDialogContext";
import { useAuth } from "@/context/AuthContext";
import { useAdminUsers } from "@/hooks/useAdminUsers";
import { useServerStatus } from "@/hooks/useServerStatus";
import {
  ArrowPathIcon,
  PencilSquareIcon,
  TrashIcon,
  UserPlusIcon,
} from "@heroicons/react/16/solid";
import { Button } from "@tw/button";
import {
  DescriptionDetails,
  DescriptionList,
  DescriptionTerm,
} from "@tw/description-list";
import { Heading } from "@tw/heading";
import { Link } from "@tw/link";
import { Listbox, ListboxLabel, ListboxOption } from "@tw/listbox";
import { Switch, SwitchField } from "@tw/switch";
import { Text } from "@/components/tailwind/text";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@tw/table";
import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { translate, useTranslation, type TranslationKey } from "@/i18n";
import {
  BACKEND_RELEASES_API,
  findBackendUpdate,
  sortUsers,
  type UserSort,
} from "@/utils/adminExtras";
import { fetchPublicText } from "@/themes/communityThemes";
import { invalidateGamesCache } from "@/hooks/useGames";
import Card from "../components/Card";
import { maskUrl, maskUser, useStreamerMode } from "@/utils/streamerMode";
import { RegisterUserModal } from "@/components/admin/RegisterUserModal";
import { UserEditorModal } from "@/components/admin/UserEditorModal";
import { PlaystashUser, PlaystashUserRoleEnum } from "../api";
import { ROLE_LABELS } from "@/utils/roles";
import BackupRestoreDialog from "../components/admin/BackupRestoreDialog";
import { Label } from "../components/tailwind/fieldset";
import { FolderTagRules } from "@/components/admin/FolderTagRules";
import { ServerDiagnostics } from "@/components/admin/ServerDiagnostics";
import { getErrorMessage } from "@/utils/apiError";
import { formatMessage } from "@/utils/formatMessage";
import "@/styles/workspaces.css";

const USER_SORT_LABELS: Record<UserSort, TranslationKey> = {
  username: "admin.sort.username",
  activation: "admin.sort.activation",
  role: "admin.sort.role",
};

/**
 * Shows an inline error instead of the page when rendering the
 * administration page (or any of its sections) fails.
 */
class AdministrationErrorBoundary extends Component<
  { children: ReactNode },
  { error: unknown }
> {
  state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error ?? new Error("Unknown error") };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="p-8 text-sm text-red-500 space-y-4">
        <p>{translate("admin.page.renderFailed")}</p>
        <pre className="whitespace-pre-wrap bg-red-500/10 p-4 rounded">
          {(error as { message?: string })?.message || String(error)}
        </pre>
      </div>
    );
  }
}

export default function Administration() {
  return (
    <AdministrationErrorBoundary>
      <AdministrationContent />
    </AdministrationErrorBoundary>
  );
}

function AdministrationContent() {
  const { t } = useTranslation();
  const streamerMode = useStreamerMode();
  const {
    users,
    loading,
    error,
    toggleActivated,
    updateUserRole,
    deleteUser,
    recoverUser,
    opBusy,
    updateUser,
    setUsers,
  } = useAdminUsers();
  const { serverUrl, user: currentUser, authFetch } = useAuth();
  const [showBackupRestoreDialog, setShowBackupRestoreDialog] = useState(false);

  const { showAlert } = useAlertDialog();
  const {
    info,
    error: statusError,
    loading: statusLoading,
  } = useServerStatus();
  const version = info?.version;
  const connected = !!serverUrl && !!info && !statusLoading && !statusError;
  const [reindexing, setReindexing] = useState(false);
  const [reindexError, setReindexError] = useState<string | null>(null);

  // State: show deleted users toggle
  const [showDeleted, setShowDeleted] = useState(false);
  const [userSort, setUserSort] = useState<UserSort>("username");
  const [update, setUpdate] = useState<{ version: string; url: string } | null>(
    null,
  );

  // Backend update check (unauthenticated GitHub releases API).
  useEffect(() => {
    if (!version) return;
    let cancelled = false;
    (async () => {
      try {
        const releases = JSON.parse(
          await fetchPublicText(BACKEND_RELEASES_API),
        );
        if (!cancelled) setUpdate(findBackendUpdate(releases, version));
      } catch {
        if (!cancelled) setUpdate(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [version]);
  // State: edit modal + register modal
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [showRegister, setShowRegister] = useState(false);

  const currentEditingUser = useMemo(() => {
    if (editingUserId == null) return null;
    return users.find((u) => u.id === editingUserId) || null;
  }, [editingUserId, users]);

  const filteredUsers = useMemo(() => {
    const visible = showDeleted ? users : users.filter((u) => !u.deleted_at);
    return sortUsers(visible, userSort);
  }, [users, showDeleted, userSort]);

  return (
    <div className="ps-workspace flex min-h-full flex-col gap-6">
      <div className="workspace-heading">
        <div className="space-y-2">
          <Heading>{t("nav.admin")}</Heading>
          <Text className="max-w-2xl">{t("admin.page.description")}</Text>
        </div>
      </div>
      <div className="admin-sections flex flex-col">
        <Card title={t("admin.server.title")}>
          <DescriptionList>
            <DescriptionTerm>{t("admin.server.address")}</DescriptionTerm>
            <DescriptionDetails>
              {connected ? (
                <Link
                  href={streamerMode ? maskUrl(serverUrl) : serverUrl}
                  target="_blank"
                >
                  {streamerMode ? maskUrl(serverUrl) : serverUrl}
                </Link>
              ) : (
                <span className="text-ps-muted">
                  {t("admin.server.notConnected")}
                </span>
              )}
            </DescriptionDetails>
            <DescriptionTerm>{t("common.version")}</DescriptionTerm>
            <DescriptionDetails>
              {version ? (
                <Link
                  href={`https://github.com/PlayStash/playstash-backend/releases/tag/v${version}`}
                  target="_blank"
                >
                  {version}
                </Link>
              ) : (
                <span className="text-ps-muted">—</span>
              )}
              {update && (
                <>
                  {" "}
                  <Link
                    href={update.url}
                    target="_blank"
                    className="font-semibold text-ps-danger!"
                    title={update.version}
                  >
                    {t("admin.updateAvailable")}
                  </Link>
                </>
              )}
            </DescriptionDetails>
            <DescriptionTerm>{t("admin.users.title")}</DescriptionTerm>
            <DescriptionDetails>
              {users.length}{" "}
              {users.length > 0 && filteredUsers.length !== users.length && (
                <span className="text-ps-muted">
                  {formatMessage(t("admin.server.shown"), {
                    count: filteredUsers.length,
                  })}
                </span>
              )}
            </DescriptionDetails>
          </DescriptionList>
        </Card>
        {connected && (
          <Card
            className="grid md:grid-cols-2 gap-4"
            title={t("admin.actions.title")}
          >
            <Button
              color="indigo"
              onClick={() => setShowBackupRestoreDialog(true)}
              title={t("admin.backup.title")}
              className="items-center"
            >
              {t("admin.backup.title")}
            </Button>
            <Button
              color="indigo"
              disabled={reindexing}
              onClick={async () => {
                if (reindexing) return;
                try {
                  setReindexError(null);
                  setReindexing(true);
                  const base = serverUrl.replace(/\/+$/, "");

                  const res = await authFetch(`${base}/api/games/reindex`, {
                    method: "PUT",
                  });
                  if (!res.ok) {
                    throw new Error(
                      await getErrorMessage(
                        res,
                        formatMessage(t("admin.reindex.failed"), {
                          status: res.status,
                        }),
                      ),
                    );
                  }
                  void showAlert({
                    title: t("admin.reindex.success"),
                    tone: "success",
                  });
                } catch (e: any) {
                  setReindexError(e.message || String(e));
                } finally {
                  setReindexing(false);
                  // The library reloads after a reindex (success or not).
                  invalidateGamesCache();
                }
              }}
              title={t("admin.reindex.button")}
              className="items-center"
            >
              {reindexing
                ? t("admin.reindex.running")
                : t("admin.reindex.button")}
            </Button>
            {reindexError && (
              <p
                role="alert"
                className="col-span-full rounded-md bg-ps-danger/10 p-3 text-sm break-words text-ps-danger"
              >
                {reindexError}
              </p>
            )}
            <Text className="col-span-full text-sm">
              {t("admin.actions.frontendUpdate")}
            </Text>
          </Card>
        )}
        <Card title={t("admin.folderTags.title")}>
          <FolderTagRules />
        </Card>
        <Card title={t("admin.diagnostics.title")}>
          <ServerDiagnostics />
        </Card>
        <Card title={t("admin.users.title")}>
          {error && (
            <div
              role="alert"
              className="mb-4 rounded-md bg-ps-danger/10 p-3 text-sm break-words text-ps-danger"
            >
              {error}
            </div>
          )}
          <div className="admin-user-tools">
            <SwitchField>
              <Switch
                name="showDeleted"
                color="indigo"
                checked={showDeleted}
                onChange={() => setShowDeleted((v) => !v)}
              />
              <Label>{t("admin.users.showDeleted")}</Label>
            </SwitchField>
            <div className="ml-auto w-full sm:w-52">
              <Listbox
                name="userSort"
                aria-label={t("admin.sort.label")}
                value={userSort}
                onChange={(value: any) => setUserSort(value as UserSort)}
              >
                {(Object.keys(USER_SORT_LABELS) as UserSort[]).map((key) => (
                  <ListboxOption key={key} value={key}>
                    <ListboxLabel>{t(USER_SORT_LABELS[key])}</ListboxLabel>
                  </ListboxOption>
                ))}
              </Listbox>
            </div>
            <Button
              color="indigo"
              onClick={() => setShowRegister(true)}
              title={t("admin.register.title")}
              className="items-center"
            >
              <UserPlusIcon className="size-5" />
              <span className="text-sm leading-none">
                {t("admin.users.register")}
              </span>
            </Button>
          </div>
          <Table className="[--gutter:--spacing(6)] sm:[--gutter:--spacing(8)]">
            <TableHead>
              <TableRow>
                <TableHeader>{t("common.name")}</TableHeader>
                <TableHeader>{t("admin.users.activated")}</TableHeader>
                <TableHeader>{t("admin.users.role")}</TableHeader>
                <TableHeader>{t("admin.actions.title")}</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <div className="flex items-center justify-center gap-2 py-6 text-sm text-ps-muted">
                      <svg
                        className="h-4 w-4 motion-safe:animate-spin"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      {t("admin.users.loading")}
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {!loading && filteredUsers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <div className="py-6 text-center text-sm text-ps-muted">
                      {t("admin.users.empty")}
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {filteredUsers.map((u: PlaystashUser) => {
                const id = u.id;
                const deleted = u.deleted_at;
                const busy = opBusy[String(id)];
                const name = u.username || t("admin.users.unknown");
                const first_name = u.first_name;
                const last_name = u.last_name;
                const email = u.email;
                const roleNumeric = u.role ?? PlaystashUserRoleEnum._0;
                const masked = streamerMode ? maskUser(u) : null;
                const displayName = masked?.displayName ?? name;
                const displayEmail = masked?.email ?? email;
                const displayFull = streamerMode
                  ? ""
                  : `${first_name ?? ""} ${last_name ?? ""}`.trim();
                return (
                  <TableRow
                    key={id}
                    className={deleted ? "opacity-60" : undefined}
                  >
                    <TableCell>
                      <div className="flex items-center gap-4">
                        <Link
                          href={`/community/${id}`}
                          className="shrink-0 rounded-full outline-hidden focus:outline-2 focus:outline-offset-2 focus:outline-ps-accent-cool"
                        >
                          <UserAvatar
                            media={u.avatar}
                            size={48}
                            alt={displayName}
                            seed={String(u.id)}
                          />
                        </Link>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                            <span className="min-w-0 [overflow-wrap:anywhere]">
                              {displayName}{" "}
                              {!streamerMode && (first_name || last_name) && (
                                <span className="font-normal">
                                  ({displayFull})
                                </span>
                              )}
                            </span>
                            {deleted && (
                              <span className="shrink-0 rounded-sm bg-ps-danger/15 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-ps-danger">
                                {t("admin.users.deleted")}
                              </span>
                            )}
                          </div>
                          {displayEmail && (
                            <div className="text-ps-muted [overflow-wrap:anywhere]">
                              <a
                                href={
                                  streamerMode ? undefined : `mailto:${email}`
                                }
                                className="hover:text-ps-text"
                              >
                                {displayEmail}
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Switch
                        name="activated"
                        color="indigo"
                        checked={!!u.activated}
                        disabled={!!deleted || busy}
                        onChange={() => toggleActivated(u)}
                      />
                    </TableCell>
                    <TableCell className="text-ps-muted">
                      <Listbox
                        name="role"
                        value={roleNumeric}
                        onChange={async (val: any) => {
                          const nextRole = String(val) as PlaystashUserRoleEnum;
                          if (
                            currentUser &&
                            currentUser.id === u.id &&
                            nextRole !== roleNumeric
                          ) {
                            const proceed = await showAlert({
                              title: t("admin.users.ownRole.title"),
                              description: t("admin.users.ownRole.description"),
                              affirmativeText: t("admin.users.ownRole.confirm"),
                              negativeText: t("common.cancel"),
                            });
                            if (!proceed) return; // abort
                          }
                          updateUserRole(u, nextRole);
                        }}
                        disabled={!!deleted || busy}
                      >
                        {Object.values(PlaystashUserRoleEnum).map((r) => (
                          <ListboxOption key={r} value={r}>
                            <ListboxLabel>
                              {ROLE_LABELS[Number(r)]
                                ? t(ROLE_LABELS[Number(r)])
                                : r}
                            </ListboxLabel>
                          </ListboxOption>
                        ))}
                      </Listbox>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2 justify-end">
                        {!deleted && (
                          <Button
                            color="rose"
                            disabled={busy}
                            onClick={() => deleteUser(u)}
                            title={t("admin.users.delete")}
                          >
                            <TrashIcon />{" "}
                            <span className="sr-only">
                              {t("common.delete")}
                            </span>
                          </Button>
                        )}
                        {deleted && (
                          <Button
                            color="green"
                            disabled={busy}
                            onClick={() => recoverUser(u)}
                            title={t("admin.users.recover")}
                          >
                            <ArrowPathIcon />{" "}
                            <span className="sr-only">
                              {t("admin.users.recoverShort")}
                            </span>
                          </Button>
                        )}
                        <Button
                          color="indigo"
                          onClick={() => setEditingUserId(Number(id))}
                          title={t("admin.users.edit")}
                          className="bg-ps-accent!"
                          disabled={busy}
                        >
                          <PencilSquareIcon />{" "}
                          <span className="sr-only">{t("common.edit")}</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <div id="portal-modals" className="contents">
            {currentEditingUser && (
              <UserEditorModal
                user={currentEditingUser}
                onClose={() => setEditingUserId(null)}
                onSave={async (payload) =>
                  updateUser(currentEditingUser, {
                    ...payload,
                    // Convert birth_date string|null to Date if present, otherwise undefined to satisfy typing
                    birth_date: payload.birth_date
                      ? new Date(payload.birth_date)
                      : undefined,
                  })
                }
                onUserUpdated={(updated) => {
                  setUsers((prev) =>
                    prev.map((u) =>
                      u.id === updated.id ? { ...u, ...updated } : u,
                    ),
                  );
                }}
              />
            )}
            {showRegister && (
              <RegisterUserModal
                onClose={() => setShowRegister(false)}
                onRegistered={(u) => {
                  setUsers((prev) => [...prev, u]);
                }}
              />
            )}
          </div>
        </Card>
        {showBackupRestoreDialog && (
          <BackupRestoreDialog
            onClose={() => setShowBackupRestoreDialog(false)}
          />
        )}
      </div>
    </div>
  );
}
