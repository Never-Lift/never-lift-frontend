import { zodResolver } from '@hookform/resolvers/zod'
import { LoaderCircle, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { AvatarPicker } from '@/components/AvatarPicker'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import type { Account, AccountChanges } from '@/lib/auth-types'
import { getErrorMessage } from '@/lib/error-messages'

const accountSchema = z.object({
  displayName: z.string().trim().min(1, 'Informe o nome de exibição.'),
  avatarId: z.string().optional(),
  password: z
    .string()
    .refine(
      (password) => !password || (/^\S+$/.test(password) && password.length >= 4),
      'A nova senha deve ter ao menos 4 caracteres e nenhum espaço.',
    ),
  currentPassword: z.string().min(1, 'Informe sua senha atual.'),
})

type AccountFormValues = z.infer<typeof accountSchema>

type AccountEditFormProps = {
  account: Account
  onSubmit: (changes: AccountChanges) => Promise<Account>
}

export function AccountEditForm({
  account,
  onSubmit,
}: AccountEditFormProps) {
  const [feedback, setFeedback] = useState<
    { type: 'error' | 'success'; message: string } | undefined
  >()
  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      displayName: account.displayName,
      avatarId: account.avatarId ?? undefined,
      password: '',
      currentPassword: '',
    },
  })

  useEffect(() => {
    form.reset({
      displayName: account.displayName,
      avatarId: account.avatarId ?? undefined,
      password: '',
      currentPassword: '',
    })
  }, [account, form])

  async function submit(values: AccountFormValues) {
    setFeedback(undefined)

    try {
      await onSubmit({
        currentPassword: values.currentPassword,
        displayName: values.displayName,
        avatarId: values.avatarId ?? null,
        password: values.password || undefined,
      })
      setFeedback({ type: 'success', message: 'Conta atualizada com sucesso.' })
    } catch (error) {
      setFeedback({ type: 'error', message: getErrorMessage(error) })
    }
  }

  return (
    <Form {...form}>
      <form className="space-y-7" onSubmit={form.handleSubmit(submit)}>
        <div className="grid gap-5 border-b border-border/70 pb-7 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="displayName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nome de exibição</FormLabel>
                <FormControl>
                  <Input autoComplete="name" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nova senha</FormLabel>
                <FormControl>
                  <Input
                    autoComplete="new-password"
                    placeholder="Deixe vazio para manter"
                    type="password"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <AvatarPicker
          disabled={form.formState.isSubmitting}
          onChange={(avatarId) =>
            form.setValue('avatarId', avatarId, { shouldDirty: true })
          }
          value={form.watch('avatarId')}
        />

        <FormField
          control={form.control}
          name="currentPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Senha atual</FormLabel>
              <FormControl>
                <Input
                  autoComplete="current-password"
                  placeholder="Confirme para salvar as alterações"
                  type="password"
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Obrigatória para confirmar qualquer alteração nesta conta.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {feedback && (
          <p
            className={
              feedback.type === 'error'
                ? 'rounded-[10px] border border-destructive/35 bg-destructive/8 px-3.5 py-3 text-sm font-medium text-destructive'
                : 'rounded-[10px] border border-success/35 bg-success/8 px-3.5 py-3 text-sm font-medium text-success'
            }
            role={feedback.type === 'error' ? 'alert' : 'status'}
          >
            {feedback.message}
          </p>
        )}

        <Button disabled={form.formState.isSubmitting} type="submit">
          {form.formState.isSubmitting ? (
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Save aria-hidden="true" className="size-4" />
          )}
          Salvar alterações
        </Button>
      </form>
    </Form>
  )
}
