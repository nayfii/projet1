"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { MailIcon, MoreHorizontalIcon, PlusIcon, ShieldIcon, UserMinusIcon, UserCheckIcon, PencilIcon, UsersRoundIcon } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/form";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ErrorCode } from "@/lib/errors";
import { revokeInvitationAction, setMemberTeamAction, updateMemberAction } from "../server/actions";
import { ADMIN_SCOPES, AVAILABLE_SCOPES, type AdminScope } from "../scopes";
import type { MemberRow } from "../server/queries";
import { InviteForm } from "./invite-form";

type Invitation = { id: string; email: string; role: "owner" | "admin" | "manager" | "member"; createdAt: string };

export function MembersManager({
  header,
  members,
  invitations,
  currentUserId,
  isOwner,
}: {
  header: { title: string; description: string };
  members: MemberRow[];
  invitations: Invitation[];
  currentUserId: string;
  isOwner: boolean;
}) {
  const t = useTranslations("members");
  const tRoles = useTranslations("roles");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<{ member: MemberRow; asManager: boolean } | null>(null);
  const [scopesFor, setScopesFor] = useState<MemberRow | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: ErrorCode }>, success: string) =>
    startTransition(async () => {
      const result = await fn();
      if (result.ok) toast.success(success);
      else toast.error(tErrors(result.error ?? "unknown"));
    });

  return (
    <div className="space-y-8">
      <PageHeader
        className="pb-0"
        title={header.title}
        description={header.description}
        actions={
          <Button onClick={() => setInviteOpen(true)}>
            <PlusIcon />
            {t("invite")}
          </Button>
        }
      />

      <Card className="divide-y overflow-hidden">
        {members.map((m) => {
          const isSelf = m.userId === currentUserId;
          // Admins manage Members and Managers' details; roles are the Owner's call (enforced in admin_update_member).
          const canEdit = m.role !== "owner" && (isOwner || m.role === "member" || m.role === "manager");
          return (
            <div key={m.userId} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap">
              <Avatar name={m.fullName ?? m.email} src={m.avatarUrl} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  {m.fullName ?? m.email}
                  {isSelf ? <span className="text-xs font-normal text-muted-foreground">{t("you")}</span> : null}
                </p>
                <p className="truncate text-[13px] text-muted-foreground">
                  {[m.jobTitle, m.teamName, m.fullName ? m.email : null].filter(Boolean).join(" · ")}
                </p>
                {m.expertise.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {m.expertise.map((e) => (
                      <Badge key={e} variant="outline">
                        {e}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {m.status === "deactivated" ? <Badge variant="destructive">{t("deactivated")}</Badge> : null}
                <Badge variant={m.role === "member" ? "neutral" : "brand"}>{tRoles(m.role)}</Badge>
                {canEdit && !isSelf ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={t("actions")} disabled={pending}>
                        <MoreHorizontalIcon />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditing({ member: m, asManager: false })}>
                        <PencilIcon />
                        {t("editDetails")}
                      </DropdownMenuItem>
                      {isOwner ? (
                        <>
                          <DropdownMenuItem onSelect={() => setScopesFor(m)}>
                            <ShieldIcon />
                            {m.role === "admin" ? t("editScopes") : t("makeAdmin")}
                          </DropdownMenuItem>
                          {m.role !== "manager" ? (
                            <DropdownMenuItem onSelect={() => setEditing({ member: m, asManager: true })}>
                              <UsersRoundIcon />
                              {t("makeManager")}
                            </DropdownMenuItem>
                          ) : null}
                          {m.role !== "member" ? (
                            <DropdownMenuItem
                              onSelect={() => run(() => updateMemberAction({ userId: m.userId, role: "member" }), t("updated"))}
                            >
                              <UserMinusIcon />
                              {t("makeMember")}
                            </DropdownMenuItem>
                          ) : null}
                        </>
                      ) : null}
                      <DropdownMenuSeparator />
                      {m.status === "active" ? (
                        <DropdownMenuItem
                          destructive
                          onSelect={() => run(() => updateMemberAction({ userId: m.userId, status: "deactivated" }), t("updated"))}
                        >
                          <UserMinusIcon />
                          {t("deactivate")}
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          onSelect={() => run(() => updateMemberAction({ userId: m.userId, status: "active" }), t("updated"))}
                        >
                          <UserCheckIcon />
                          {t("reactivate")}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <span className="size-8" />
                )}
              </div>
            </div>
          );
        })}
      </Card>

      {invitations.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium">{t("pendingTitle")}</h2>
          <Card className="divide-y overflow-hidden">
            {invitations.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <MailIcon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{inv.email}</p>
                  <p className="text-[13px] text-muted-foreground">
                    {t("invitedOn", { date: format.dateTime(new Date(inv.createdAt), { dateStyle: "medium" }) })}
                  </p>
                </div>
                <Badge variant="neutral">{tRoles(inv.role)}</Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(() => revokeInvitationAction(inv.id), t("revoked"))}
                >
                  {t("revoke")}
                </Button>
              </div>
            ))}
          </Card>
        </section>
      ) : null}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-lg" closeLabel={tCommon("close")}>
          <DialogHeader>
            <DialogTitle>{t("inviteTitle")}</DialogTitle>
            <DialogDescription>{t("inviteDescription")}</DialogDescription>
          </DialogHeader>
          <InviteForm canInviteAdmins={isOwner} />
        </DialogContent>
      </Dialog>

      {editing ? (
        <EditMemberDialog
          member={editing.member}
          asManager={editing.asManager}
          teams={[...new Set(members.map((m) => m.teamName).filter((n): n is string => Boolean(n)))]}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {scopesFor ? <ScopesDialog member={scopesFor} onClose={() => setScopesFor(null)} /> : null}
    </div>
  );
}

/** Details of an employee; with asManager, the same form names them Manager of the team typed here. */
function EditMemberDialog({
  member,
  teams,
  asManager,
  onClose,
}: {
  member: MemberRow;
  teams: string[];
  asManager: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("members");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const [jobTitle, setJobTitle] = useState(member.jobTitle ?? "");
  const [expertise, setExpertise] = useState(member.expertise.join(", "));
  const [team, setTeam] = useState(member.teamName ?? "");
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={tCommon("close")}>
        <DialogHeader>
          <DialogTitle>{asManager ? t("managerTitle", { name: member.fullName ?? member.email }) : (member.fullName ?? member.email)}</DialogTitle>
          {asManager ? <DialogDescription>{t("managerDescription")}</DialogDescription> : null}
        </DialogHeader>
        <div className="space-y-4">
          <Field label={t("jobTitle")} htmlFor="edit-job">
            <Input id="edit-job" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={120} />
          </Field>
          <Field label={t("expertise")} htmlFor="edit-expertise" hint={t("expertiseHint")}>
            <Input id="edit-expertise" value={expertise} onChange={(e) => setExpertise(e.target.value)} />
          </Field>
          <Field label={t("team")} htmlFor="edit-team" hint={asManager ? t("managerTeamHint") : t("teamHint")}>
            <Input id="edit-team" list="edit-team-options" value={team} onChange={(e) => setTeam(e.target.value)} maxLength={80} />
            <datalist id="edit-team-options">
              {teams.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {tCommon("cancel")}
          </Button>
          <Button
            disabled={pending || (asManager && !team.trim())}
            onClick={() =>
              startTransition(async () => {
                const result = await updateMemberAction({
                  userId: member.userId,
                  jobTitle,
                  expertise: expertise.split(",").map((s) => s.trim()).filter(Boolean),
                });
                const teamResult = result.ok && team.trim() !== (member.teamName ?? "") ? await setMemberTeamAction({ userId: member.userId, team }) : result;
                // A Manager always leads a team: the team is set first, then the role.
                const roleResult = teamResult.ok && asManager ? await updateMemberAction({ userId: member.userId, role: "manager" }) : teamResult;
                if (roleResult.ok) {
                  toast.success(t("updated"));
                  onClose();
                } else toast.error(tErrors(roleResult.error));
              })
            }
          >
            {asManager ? t("makeManagerConfirm") : tCommon("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScopesDialog({ member, onClose }: { member: MemberRow; onClose: () => void }) {
  const t = useTranslations("members");
  const tScopes = useTranslations("scopes");
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");
  const [scopes, setScopes] = useState<AdminScope[]>(
    member.adminScopes.filter((s): s is AdminScope => (ADMIN_SCOPES as readonly string[]).includes(s)),
  );
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent closeLabel={tCommon("close")}>
        <DialogHeader>
          <DialogTitle>{t("scopesTitle", { name: member.fullName ?? member.email })}</DialogTitle>
          <DialogDescription>{t("scopesDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2.5">
          {ADMIN_SCOPES.map((scope) => (
            <label key={scope} className="flex items-center gap-2.5 text-sm">
              <Checkbox
                checked={scopes.includes(scope)}
                onCheckedChange={(checked) =>
                  setScopes((prev) => (checked ? [...prev, scope] : prev.filter((s) => s !== scope)))
                }
              />
              <span>{tScopes(scope)}</span>
              {!AVAILABLE_SCOPES.includes(scope) ? <span className="text-xs text-muted-foreground">{t("scopeLater")}</span> : null}
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {tCommon("cancel")}
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await updateMemberAction({ userId: member.userId, role: "admin", scopes });
                if (result.ok) {
                  toast.success(t("updated"));
                  onClose();
                } else toast.error(tErrors(result.error));
              })
            }
          >
            {tCommon("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
