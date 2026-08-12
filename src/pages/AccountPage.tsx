import { LoaderCircle, Trash2, UserRound } from 'lucide-react'
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
    <AppShell>
      <section className="mx-auto max-w-4xl">
        <div className="mb-8 flex items-start gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl border border-primary/40 bg-primary/10 text-primary">
            <UserRound aria-hidden="true" className="size-5" />
          </span>
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">
              Perfil do piloto
            </p>
            <h1 className="mt-1 text-3xl font-black tracking-[-0.04em] sm:text-5xl">
              Minha conta
            </h1>
            {account && (
              <p className="mt-2 text-muted-foreground">@{account.gamertag}</p>
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-border bg-card/80 p-6 shadow-2xl shadow-black/20 backdrop-blur sm:p-8">
          {account ? (
            <AccountEditForm account={account} onSubmit={updateAccount} />
          ) : loadingError ? (
            <p className="text-sm text-destructive" role="alert">
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

        <div className="mt-8 rounded-3xl border border-destructive/35 bg-destructive/5 p-6 sm:p-8">
          <h2 className="text-xl font-bold text-destructive">Zona de perigo</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Excluir sua conta apaga permanentemente o perfil. Esta ação não pode
            ser desfeita.
          </p>

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
              <Button className="mt-5" variant="destructive">
                <Trash2 aria-hidden="true" className="size-4" />
                Excluir conta
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Excluir sua conta para sempre?</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta ação é irreversível. Informe sua senha atual e confirme
                  somente se deseja apagar permanentemente sua conta.
                </AlertDialogDescription>
              </AlertDialogHeader>

              <div className="space-y-2">
                <label className="text-sm font-semibold" htmlFor="delete-password">
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
                  <p className="text-xs font-medium text-destructive" role="alert">
                    {deleteError}
                  </p>
                )}
              </div>

              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
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
      </section>
    </AppShell>
  )
}
