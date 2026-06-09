# =============================================================================
# EnterpriseHelloWorld — Terraform para Kind
# Provisionando infraestrutura local para um Hello World enterprise.
# Porque até saudação merece IaC.
# =============================================================================

terraform {
  required_version = ">= 1.5"

  required_providers {
    kind = {
      source  = "tehcyx/kind"
      version = "~> 0.0.17"
    }
    kubectl = {
      source  = "gavinbunney/kubectl"
      version = "~> 1.14"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.11"
    }
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.0"
    }
    null = {
      source = "hashicorp/null"
    }
  }
}

provider "kind" {}
provider "docker" {}

# =============================================================================
# Kind Cluster — Orquestrando contêineres de saudação
# =============================================================================

resource "kind_cluster" "greeting" {
  name = "enterprise-hello-world"

  kind_config {
    kind        = "Cluster"
    api_version = "kind.x-k8s.io/v1alpha4"

    node {
      role = "control-plane"

      extra_port_mappings {
        container_port = 80
        host_port      = 8080
      }
    }

    node {
      role = "worker"
    }

    node {
      role = "worker"
    }
  }

  # TODO: adicionar node pool dedicado para o space-service
}

# =============================================================================
# Docker Images locais — Build dos microsserviços de saudação
# =============================================================================

resource "docker_image" "hello_service" {
  name         = "pas-hello:latest"
  build {
    context    = "${path.module}/../services/hello-service"
  }
}

resource "docker_image" "space_service" {
  name         = "pas-space:latest"
  build {
    context    = "${path.module}/../services/space-service"
  }
}

resource "docker_image" "world_service" {
  name         = "pas-world:latest"
  build {
    context    = "${path.module}/../services/world-service"
  }
}

resource "docker_image" "exclamation_service" {
  name         = "pas-exclamation:latest"
  build {
    context    = "${path.module}/../services/exclamation-service"
  }
}

resource "docker_image" "orchestrator" {
  name         = "pas-orchestrator:latest"
  build {
    context    = "${path.module}/../services/orchestrator"
  }
}

# =============================================================================
# Kind Load — Carregando imagens no cluster
# =============================================================================

resource "null_resource" "load_images" {
  depends_on = [
    kind_cluster.greeting,
    docker_image.hello_service,
    docker_image.space_service,
    docker_image.world_service,
    docker_image.exclamation_service,
    docker_image.orchestrator,
  ]

  provisioner "local-exec" {
    command = <<EOT
      kind load docker-image pas-hello:latest --name enterprise-hello-world
      kind load docker-image pas-space:latest --name enterprise-hello-world
      kind load docker-image pas-world:latest --name enterprise-hello-world
      kind load docker-image pas-exclamation:latest --name enterprise-hello-world
      kind load docker-image pas-orchestrator:latest --name enterprise-hello-world
    EOT
  }
}

# =============================================================================
# Kubernetes — Aplicando manifestos
# =============================================================================

resource "null_resource" "apply_k8s" {
  depends_on = [null_resource.load_images]

  provisioner "local-exec" {
    command = <<EOT
      kubectl apply -f ${path.module}/../k8s/namespace.yaml
      kubectl apply -f ${path.module}/../k8s/
      kubectl rollout status deployment/orchestrator -n print-as-a-service --timeout=5m
    EOT
  }
}

output "cluster_name" {
  value = kind_cluster.greeting.name
}

output "greeting_endpoint" {
  value = "http://localhost:8080/greet"
  description = "Endpoint para gerar seu Hello World enterprise"
}
