import { ApiError } from '@/lib/api'

const errorMessages: Record<string, string> = {
  invalid_credentials: 'Gamertag ou senha inválidos.',
  invalid_current_password: 'A senha atual está incorreta.',
  gamertag_taken: 'Este gamertag já está em uso.',
  validation_error: 'Revise os campos destacados e tente novamente.',
  authentication_required: 'Sua sessão expirou. Faça login novamente.',
}

export function getErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.code) {
    return errorMessages[error.code] ?? error.message
  }

  return error instanceof Error
    ? error.message
    : 'Não foi possível concluir a solicitação.'
}
