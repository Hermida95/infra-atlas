"""Deterministic 3D force layout. Port of relax() in prototypes/brain/index.html."""

from __future__ import annotations

import math
import random
from collections.abc import Mapping, Sequence

from brain.models import Domain, Node

Vec3 = tuple[float, float, float]

RADIUS = 240.0
Y_SQUASH = 0.8
JITTER = 25.0
ITERATIONS = 320
REPULSION = 1200.0
HUB_REPULSION = 2600.0
SAME_DOMAIN_LENGTH, CROSS_DOMAIN_LENGTH = 34.0, 72.0
SAME_DOMAIN_STIFFNESS, CROSS_DOMAIN_STIFFNESS = 0.08, 0.012
ANCHOR_PULL = 0.03
DAMPING = 0.5
DEFAULT_SEED = 42


def compute_layout(
    nodes: Sequence[Node],
    domains: Mapping[str, Domain],
    links: Sequence[tuple[str, str]],
    seed: int = DEFAULT_SEED,
) -> dict[str, Vec3]:
    """Return node id -> position rounded to 1 decimal. Independent of input order."""
    ordered = sorted(nodes, key=lambda n: (domains[n.domain].order, n.id))
    index = {node.id: i for i, node in enumerate(ordered)}
    rng = random.Random(seed)

    anchors = [_anchor(domains[node.domain]) for node in ordered]
    pos = [[c + rng.uniform(-JITTER, JITTER) for c in anchor] for anchor in anchors]
    vel = [[0.0, 0.0, 0.0] for _ in ordered]
    hub = [node.meta.hub for node in ordered]
    domain_of = [node.domain for node in ordered]
    edges = [(index[s], index[t]) for s, t in links if s in index and t in index]
    count = len(ordered)

    for iteration in range(ITERATIONS):
        alpha = 1 - iteration / ITERATIONS

        for a in range(count):
            pa = pos[a]
            for b in range(a + 1, count):
                pb = pos[b]
                dx, dy, dz = pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]
                length_sq = dx * dx + dy * dy + dz * dz
                strength = HUB_REPULSION if hub[a] or hub[b] else REPULSION
                force = strength / max(length_sq, 1.0) * alpha
                length = math.sqrt(length_sq)
                if length == 0:  # three.js normalize() of a zero vector stays zero
                    continue
                scale = force / length
                fx, fy, fz = dx * scale, dy * scale, dz * scale
                va, vb = vel[a], vel[b]
                va[0] += fx
                va[1] += fy
                va[2] += fz
                vb[0] -= fx
                vb[1] -= fy
                vb[2] -= fz

        for s, t in edges:
            ps, pt = pos[s], pos[t]
            dx, dy, dz = pt[0] - ps[0], pt[1] - ps[1], pt[2] - ps[2]
            length = math.sqrt(dx * dx + dy * dy + dz * dz) or 1.0
            same = domain_of[s] == domain_of[t]
            rest = SAME_DOMAIN_LENGTH if same else CROSS_DOMAIN_LENGTH
            stiffness = SAME_DOMAIN_STIFFNESS if same else CROSS_DOMAIN_STIFFNESS
            scale = (length - rest) * stiffness * alpha / length
            fx, fy, fz = dx * scale, dy * scale, dz * scale
            vs, vt = vel[s], vel[t]
            vs[0] += fx
            vs[1] += fy
            vs[2] += fz
            vt[0] -= fx
            vt[1] -= fy
            vt[2] -= fz

        for i in range(count):
            p, v, c = pos[i], vel[i], anchors[i]
            for axis in range(3):
                v[axis] += (c[axis] - p[axis]) * ANCHOR_PULL * alpha
                p[axis] += v[axis]
                v[axis] *= DAMPING

    return {node.id: _rounded(pos[index[node.id]]) for node in ordered}


def _anchor(domain: Domain) -> Vec3:
    x, y, z = domain.position
    return (x * RADIUS, -y * RADIUS * Y_SQUASH, z * RADIUS)


def _rounded(vector: Sequence[float]) -> Vec3:
    # `+ 0.0` turns -0.0 into 0.0 so the JSON never shows "-0.0".
    x, y, z = (round(component, 1) + 0.0 for component in vector)
    return (x, y, z)
