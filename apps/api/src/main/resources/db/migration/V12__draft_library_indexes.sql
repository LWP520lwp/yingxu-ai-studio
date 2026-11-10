-- Native snapshot clocks drive their separate draft libraries.
CREATE INDEX ix_canvas_draft_updated ON project_canvas_engine(updated_at,project_id);
CREATE INDEX ix_science_draft_updated ON project_science_video(updated_at,project_id);
