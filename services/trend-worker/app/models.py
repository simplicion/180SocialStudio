"""Request/response models. These are the contract with packages/domains/ai/src/research/trend-worker.client.ts."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

Intent = Literal["breaking_news", "product", "comparison", "how_to", "opinion", "prediction", "factual", "concept"]


class Subquery(BaseModel):
    label: str = Field(min_length=1, max_length=40)
    search_query: str = Field(min_length=2, max_length=120)
    ranking_query: str = Field(min_length=2, max_length=240)
    sources: list[str] = Field(default_factory=list, max_length=10)
    weight: float = Field(default=1.0, ge=0.1, le=1.0)


class QueryPlan(BaseModel):
    intent: Intent = "concept"
    freshness_mode: Literal["strict_recent", "balanced_recent", "evergreen_ok"] = "balanced_recent"
    cluster_mode: Literal["story", "debate", "market", "workflow", "none"] = "none"
    subqueries: list[Subquery] = Field(min_length=1, max_length=4)


class PulseRequest(BaseModel):
    topic: str = Field(min_length=2, max_length=200)
    days: int = Field(default=30, ge=1, le=90)
    plan: Optional[QueryPlan] = None
    maxItems: int = Field(default=40, ge=1, le=80)
    withComments: bool = True

    @field_validator("topic")
    @classmethod
    def _clean_topic(cls, v: str) -> str:
        v = " ".join(v.split())
        if len(v) < 2:
            raise ValueError("topic is too short")
        return v


class Engagement(BaseModel):
    primary: Optional[float] = None
    upvotes: Optional[float] = None
    comments: Optional[float] = None
    views: Optional[float] = None
    likes: Optional[float] = None
    volume: Optional[float] = None
    raw: dict[str, float] = Field(default_factory=dict)


class PulseItem(BaseModel):
    source: str
    url: str
    title: str
    text: str = ""
    publishedAt: Optional[str] = None
    engagement: Engagement = Field(default_factory=Engagement)
    relevance: Optional[float] = None
    cluster: Optional[str] = None
    topComments: list[str] = Field(default_factory=list)


class PulseCluster(BaseModel):
    title: str
    summary: str = ""
    sources: list[str] = Field(default_factory=list)
    engagementTotal: Optional[float] = None


class PulseResponse(BaseModel):
    topic: str
    windowDays: int
    engine: Literal["last30days", "native"]
    sourceStatus: dict[str, str] = Field(default_factory=dict)
    items: list[PulseItem] = Field(default_factory=list)
    clusters: list[PulseCluster] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class FetchRequest(BaseModel):
    urls: list[str] = Field(min_length=1, max_length=6)


class FetchedPage(BaseModel):
    url: str
    ok: bool
    error: Optional[str] = None
    finalUrl: Optional[str] = None
    status: Optional[int] = None
    title: str = ""
    markdown: str = ""
    truncated: bool = False
    rendered: bool = False


class FetchResponse(BaseModel):
    pages: list[FetchedPage]


class SearchRequest(BaseModel):
    queries: list[str] = Field(min_length=1, max_length=3)
    days: int = Field(default=30, ge=1, le=365)
    maxResults: int = Field(default=6, ge=1, le=15)

    @field_validator("queries")
    @classmethod
    def _clean_queries(cls, v: list[str]) -> list[str]:
        out = [" ".join(q.split())[:200] for q in v]
        out = [q for q in dict.fromkeys(out) if len(q) >= 2]
        if not out:
            raise ValueError("at least one query of 2+ characters is required")
        return out


class SearchResult(BaseModel):
    title: str
    url: str
    snippet: str = ""
    publishedAt: Optional[str] = None
    source: str = ""
    engine: Literal["searxng", "ddgs"]
    kind: Literal["news", "web"]


class SearchResponse(BaseModel):
    results: list[SearchResult] = Field(default_factory=list)
    engines: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
