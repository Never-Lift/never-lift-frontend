import { LoaderCircle, ShieldAlert, Trash2, UserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/auth-context'
import { AccountEditForm } from '@/components/AccountEditForm'
import { AppShell } from '@/components/AppShell'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getAvatar } from '@/lib/avatars'
import { getErrorMessage } from '@/lib/error-messages'

export function AccountPage() {
  const {
    account,
    deleteAccount,
    loadAccount,
    startGuestSession,
    signOut,
    updateAccount,
  } = useAuth()
  const navigate = useNavigate()
  const [loadingError, setLoadingError] = useState<string | null>(null)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const avatar = getAvatar(account?.avatarId)

  useEffect(() => {
    if (account) return
    loadAccount().catch((error: unknown) =>
      setLoadingError(getErrorMessage(error)),
    )
  }, [account, loadAccount])

  async function handleDelete(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    setDeleteError(null)

    if (!deletePassword) {
      setDeleteError('Informe sua senha atual para excluir a conta.')
      return
    }

    setDeleting(true)
    try {
      await deleteAccount(deletePassword)
      setDialogOpen(false)
      navigate('/', { flushSync: true, replace: true })
      signOut()
      void startGuestSession()
    } catch (error) {
      setDeleteError(getErrorMessage(error))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AppShell moduleLabel="Minha conta">
      <section className="mx-auto max-w-5xl">
        <div className="mb-9 flex flex-col justify-between gap-6 border-b border-border/70 pb-8 sm:flex-row sm:items-end">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.24em] text-info">
              Perfil do piloto // 01
            </p>
            <h1 className="display-heading mt-3 text-5xl sm:text-7xl">
              Minha conta
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
              Ajuste sua identidade no paddock. Toda alteração exige a senha
              atual para proteger sua conta.
            </p>
          </div>

          {account && (
            <div className="flex items-center gap-4 rounded-2xl border border-border bg-card/70 p-3 pr-5">
              <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-primary/35 bg-primary/10">
                {avatar ? (
                  <img
                    alt={avatar.name}
                    className="size-full object-cover"
                    src={avatar.image}
                  />
                ) : (
                  <UserRound aria-hidden="true" className="size-5 text-primary" />
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate font-extrabold">{account.displayName}</p>
                <p className="truncate text-sm text-muted-foreground">
                  @{account.gamertag}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="surface-panel relative overflow-hidden p-6 sm:p-8 lg:p-10">
          <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-primary via-info to-transparent" />
          <div className="mb-8">
            <p className="font-display text-2xl font-extrabold uppercase">
              Dados da conta
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Nome, avatar e credenciais do piloto.
            </p>
          </div>

          {account ? (
            <AccountEditForm account={account} onSubmit={updateAccount} />
          ) : loadingError ? (
            <p
              className="rounded-[10px] border border-destructive/35 bg-destructive/8 p-4 text-sm font-medium text-destructive"
              role="alert"
            >
              {loadingError}
            </p>
          ) : (
            <div className="flex items-center gap-3 text-sm">
              <LoaderCircle
                aria-hidden="true"
                className="size-5 animate-spin text-primary"
              />
              Carregando conta…
            </div>
          )}
        </div>

        <div className="mt-8 overflow-hidden rounded-2xl border border-destructive/30 bg-[linear-gradient(145deg,rgb(255_64_85/0.07),rgb(13_21_36/0.9))]">
          <div className="flex flex-col justify-between gap-6 p-6 sm:flex-row sm:items-center sm:p-8">
            <div className="flex items-start gap-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-[10px] border border-destructive/35 bg-destructive/10 text-destructive">
                <ShieldAlert aria-hidden="true" className="size-5" />
              </span>
              <div>
                <h2 className="font-display text-2xl font-extrabold uppercase text-destructive">
                  Zona de perigo
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Excluir sua conta apaga permanentemente o perfil. Esta ação não
                  pode ser desfeita.
                </p>
              </div>
            </div>

            <AlertDialog
              open={dialogOpen}
              onOpenChange={(open) => {
                setDialogOpen(open)
                if (!open) {
                  setDeleteError(null)
                  setDeletePassword('')
                }
              }}
            >
              <AlertDialogTrigger asChild>
                <Button className="shrink-0" variant="destructive">
                  <Trash2 aria-hidden="true" className="size-4" />
                  Excluir conta
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Excluir sua conta para sempre?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta ação é irreversível. Informe sua senha atual e confirme
                    somente se deseja apagar permanentemente sua conta.
                  </AlertDialogDescription>
                </AlertDialogHeader>

                <div className="space-y-2">
                  <label
                    className="text-sm font-bold"
                    htmlFor="delete-password"
                  >
                    Senha atual
                  </label>
                  <Input
                    autoComplete="current-password"
                    id="delete-password"
                    onChange={(event) => setDeletePassword(event.target.value)}
                    placeholder="Confirme sua senha"
                    type="password"
                    value={deletePassword}
                  />
                  {deleteError && (
                    <p
                      className="text-xs font-semibold text-destructive"
                      role="alert"
                    >
                      {deleteError}
                    </p>
                  )}
                </div>

                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deleting}>
                    Cancelar
                  </AlertDialogCancel>
                  <AlertDialogAction disabled={deleting} onClick={handleDelete}>
                    {deleting && (
                      <LoaderCircle
                        aria-hidden="true"
                        className="size-4 animate-spin"
                      />
                    )}
                    Sim, excluir permanentemente
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </section>
    </AppShell>
  )
}
