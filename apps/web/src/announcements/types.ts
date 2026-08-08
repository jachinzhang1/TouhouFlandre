export type Announcement = {
  id: string;
  title: string;
  date: string;
  pinned: boolean;
  body: string;
  fileName: string;
};

export type AnnouncementSummary = Omit<Announcement, "body">;

export type AnnouncementReadWarning = {
  fileName: string;
  message: string;
};

export type AnnouncementReadResult = {
  announcements: Announcement[];
  warnings: AnnouncementReadWarning[];
};

export type AnnouncementsResponse = {
  announcements: Announcement[];
  generatedAt: string;
  warnings?: AnnouncementReadWarning[];
};

export type AnnouncementSummaryResponse = {
  announcements: AnnouncementSummary[];
  generatedAt: string;
  warnings?: AnnouncementReadWarning[];
};
