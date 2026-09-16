// Multi-platform builds, layered over docker-compose.yml so build contexts
// and Dockerfiles are defined once:
//
//   docker buildx bake -f docker-compose.yml -f docker-bake.hcl --print all
//   docker buildx bake -f docker-compose.yml -f docker-bake.hcl            # CPU images (both arches — needs the docker-container builder, see below)
//   docker buildx bake -f docker-compose.yml -f docker-bake.hcl worker-cuda
//
// Day-to-day local builds stay `docker compose up -d --build` (native arch
// only, loaded straight into the daemon). Producing a two-arch manifest
// needs the docker-container builder and a registry to push to:
//
//   docker buildx create --use --name multi
//   REGISTRY=ghcr.io/you/ docker buildx bake -f docker-compose.yml -f docker-bake.hcl --push all

variable "REGISTRY" {
  default = ""
}

variable "TAG" {
  default = "latest"
}

group "default" {
  targets = ["client", "api", "worker"]
}

group "cuda" {
  targets = ["worker-cuda"]
}

group "all" {
  targets = ["client", "api", "worker", "worker-cuda"]
}

target "client" {
  platforms = ["linux/amd64", "linux/arm64"]
  tags      = ["${REGISTRY}indic-nlu-client:${TAG}"]
}

target "api" {
  platforms = ["linux/amd64", "linux/arm64"]
  tags      = ["${REGISTRY}indic-nlu-api:${TAG}"]
}

// CPU worker: compose's `worker` service with both arches.
target "worker" {
  platforms = ["linux/amd64", "linux/arm64"]
  tags      = ["${REGISTRY}indic-nlu-worker:${TAG}-cpu"]
  args = {
    DEVICE = "cpu"
  }
}

// CUDA worker: same Dockerfile, TensorFlow's [and-cuda] wheels. x86_64 only.
target "worker-cuda" {
  inherits  = ["worker"]
  platforms = ["linux/amd64"]
  tags      = ["${REGISTRY}indic-nlu-worker:${TAG}-cuda"]
  args = {
    DEVICE = "cuda"
  }
}
