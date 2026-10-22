variable "project" {
  description = "Name prefix for every resource."
  type        = string
}

variable "environment" {
  description = "Environment name (dev, prod)."
  type        = string
}

variable "alert_emails" {
  description = <<-EOT
    Where the alarms go. AWS sends a confirmation mail to each address and the subscription
    does nothing until somebody clicks it -- an unconfirmed subscription is the classic reason
    an alarm "did not fire".
  EOT
  type        = list(string)

  validation {
    condition     = length(var.alert_emails) > 0
    error_message = "An alarm nobody receives is not an alarm."
  }

  validation {
    condition     = alltrue([for e in var.alert_emails : can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", e))])
    error_message = "Each entry must be an email address."
  }
}

variable "budget_thresholds" {
  description = <<-EOT
    One AWS Budget per amount, in budget_currency (decision 10 and the cost table in
    docs/DECISIONES.md ask for 5 and 10 EUR). Each one warns when the actual spend reaches it
    and again when the forecast does, which is what gives a few days' notice instead of a bill.

    Empty creates no budget. That is the right value for every environment but one: a budget
    with no cost filter measures the whole account, so a second environment would only
    duplicate the same number -- and AWS bills 0.02 USD/day per budget beyond the first two.
  EOT
  type        = list(number)
  default     = []

  validation {
    condition     = alltrue([for t in var.budget_thresholds : t > 0])
    error_message = "Thresholds must be positive."
  }

  validation {
    condition     = length(var.budget_thresholds) <= 2
    error_message = "AWS gives two budgets free and bills 0.02 USD/day for each extra one."
  }
}

variable "budget_currency" {
  description = <<-EOT
    Currency of the budget amounts. It has to be the account's own billing currency: AWS
    rejects a budget in a currency the account is not billed in.
  EOT
  type        = string
  default     = "EUR"
}

variable "budget_forecast_threshold_percent" {
  description = "Percentage of the budget whose *forecast* triggers the early warning."
  type        = number
  default     = 100
}

variable "api_id" {
  description = <<-EOT
    HTTP API to watch for 5xx. Null skips the alarm, which is what an environment without an
    API deployed yet wants.
  EOT
  type        = string
  default     = null
}

variable "api_5xx_threshold" {
  description = <<-EOT
    How many 5xx responses in one period count as a problem. Not zero: a cold start that times
    out, or a single Lambda init failure, would page on a perfectly healthy deployment.
  EOT
  type        = number
  default     = 5
}

variable "api_5xx_period_seconds" {
  description = "Length of each evaluation window."
  type        = number
  default     = 300
}

variable "api_5xx_evaluation_periods" {
  description = <<-EOT
    Consecutive windows over the threshold before the alarm fires. Two windows of five
    minutes means a sustained problem, not a blip.
  EOT
  type        = number
  default     = 2
}

variable "tags" {
  description = "Extra tags, merged on top of the provider's default_tags."
  type        = map(string)
  default     = {}
}
