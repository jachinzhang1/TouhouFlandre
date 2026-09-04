import { SearchPage } from "../../components/search/SearchPage";

type SearchParams = Record<string, string | string[] | undefined>;

const firstParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default async function SearchRoute({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  return (
    <SearchPage
      initialDirection={
        firstParam(params.direction) === "desc" ? "desc" : "asc"
      }
      initialSort={firstParam(params.sort) === "name" ? "name" : "appearance"}
      initialView={firstParam(params.view) === "list" ? "list" : "grid"}
    />
  );
}
