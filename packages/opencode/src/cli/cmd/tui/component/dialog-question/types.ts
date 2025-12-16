import type { Question } from "@/question"

export interface QuestionDialogProps {
  request: Question.Request
  onSubmit: (answers: Question.Answer[], comment?: string) => void
  onCancel: () => void
}

export interface QuestionComponentProps<Q extends Question.Item> {
  question: Q
  value: unknown
  onChange: (value: unknown) => void
  active: boolean
}
