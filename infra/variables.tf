variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "name" {
  type    = string
  default = "truecaller-campaigns"
}

variable "github_repo" {
  description = "owner/repo allowed to deploy through GitHub Actions"
  type        = string
  default     = "networkerman/truecaller-campaigns"
}

variable "create_github_oidc_provider" {
  description = "Set false if the account already has the token.actions.githubusercontent.com OIDC provider"
  type        = bool
  default     = true
}

variable "tc_provider" {
  type    = string
  default = "mock"
}
