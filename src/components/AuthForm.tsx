import { zodResolver } from '@hookform/resolvers/zod'
import { LoaderCircle, LogIn, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'

import { AvatarPicker } from '@/components/AvatarPicker'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { getErrorMessage } from '@/lib/error-messages'

const authSchema = z.object({
  gamertag: z
    .string()
    .min(1, 'Informe o gamertag.')
    .regex(/^\S+$/, 'O gamertag não pode conter espaços.'),
  password: z.string().min(1, 'Informe a senha.'),
  displayName: z.string(),
  avatarId: z.string().optional(),
})

type AuthValues = z.infer<typeof authSchema>
type LoginValues = Pick<AuthValues, 'gamertag' | 'password'>
type RegisterValues = AuthValues

type AuthFormProps =
  | {
      mode: 'login'
      onSubmit: (values: LoginValues) => Promise<void>
    }
  | {
      mode: 'register'
      onSubmit: (values: RegisterValues) => Promise<void>
    }

export function AuthForm(props: AuthFormProps) {
  const isRegister = props.mode === 'register'
  const [serverError, setServerError] = useState<string | null>(null)
  const form = useForm<AuthValues>({
    resolver: zodResolver(
      authSchema.superRefine((values, context) => {
        if (!isRegister) return

        if (!values.displayName.trim()) {
          context.addIssue({
            code: 'custom',
            message: 'Informe o nome de exibição.',
            path: ['displayName'],
          })
        }

        if (values.password.length < 4) {
          context.addIssue({
            code: 'custom',
            message: 'A senha precisa ter pelo menos 4 caracteres.',
            path: ['password'],
          })
        } else if (!/^\S+$/.test(values.password)) {
          context.addIssue({
            code: 'custom',
            message: 'A senha não pode conter espaços.',
            path: ['password'],
          })
        }
      }),
    ),
    defaultValues: {
      gamertag: '',
      displayName: '',
      password: '',
      avatarId: undefined,
    },
  })

  async function submit(values: AuthValues) {
    setServerError(null)

    try {
      if (props.mode === 'register') {
        await props.onSubmit(values)
      } else {
        await props.onSubmit({
          gamertag: values.gamertag,
          password: values.password,
        })
      }
    } catch (error) {
      setServerError(getErrorMessage(error))
    }
  }

  return (
    <Form {...form}>
      <form className="space-y-5" onSubmit={form.handleSubmit(submit)}>
        <FormField
          control={form.control}
          name="gamertag"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Gamertag</FormLabel>
              <FormControl>
                <Input
                  autoComplete="username"
                  placeholder="turbo_fox"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {isRegister && (
          <FormField
            control={form.control}
            name="displayName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nome de exibição</FormLabel>
                <FormControl>
                  <Input
                    autoComplete="name"
                    placeholder="Turbo Fox"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Senha</FormLabel>
              <FormControl>
                <Input
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
                  placeholder={isRegister ? 'Mínimo de 4 caracteres' : 'Sua senha'}
                  type="password"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {isRegister && (
          <AvatarPicker
            disabled={form.formState.isSubmitting}
            onChange={(avatarId) =>
              form.setValue('avatarId', avatarId, { shouldDirty: true })
            }
            value={form.watch('avatarId')}
          />
        )}

        {serverError && (
          <p
            className="rounded-[10px] border border-destructive/35 bg-destructive/8 px-3.5 py-3 text-sm font-medium text-destructive"
            role="alert"
          >
            {serverError}
          </p>
        )}

        <Button
          className="mt-2 w-full"
          disabled={form.formState.isSubmitting}
          size="lg"
          type="submit"
        >
          {form.formState.isSubmitting ? (
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          ) : isRegister ? (
            <UserPlus aria-hidden="true" className="size-4" />
          ) : (
            <LogIn aria-hidden="true" className="size-4" />
          )}
          {isRegister ? 'Criar conta' : 'Entrar'}
        </Button>
      </form>
    </Form>
  )
}
