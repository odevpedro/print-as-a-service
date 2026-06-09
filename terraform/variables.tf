variable "cluster_name" {
  description = "Nome do cluster Kind para o Hello World enterprise"
  type        = string
  default     = "enterprise-hello-world"
}

variable "kind_node_image" {
  description = "Imagem dos nós Kind"
  type        = string
  default     = "kindest/node:v1.28.0"
}

variable "greeting_namespace" {
  description = "Namespace Kubernetes para os microsserviços de saudação"
  type        = string
  default     = "print-as-a-service"
}
